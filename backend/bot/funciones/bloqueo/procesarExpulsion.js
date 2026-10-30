// ==========================================================================
// procesarExpulsion.js — motor ÚNICO de expulsión de bloqueados.
// ==========================================================================
// Lo usan las tres entradas: bloquear desde el panel (routes/bloqueados.js),
// el reingreso de un bloqueado a un grupo (bloqueoParticipantesGrupo.js) y
// el worker periódico (workerExpulsiones.js), que además recupera lo que
// quedó pendiente tras un reinicio.
//
// Por cada tarea (bloqueo, grupo), de forma independiente — un grupo que
// falla nunca detiene a los demás:
//
//   1. tomar la tarea (lease en BD, expulsionesRepo.tomarTarea)
//   2. el bloqueo sigue ACTIVO y es del mismo cliente; el grupo sigue
//      AUTORIZADO para ese cliente (politicaGrupos)
//   3. socket = WhatsApp activo DE ESE cliente (nunca el de otro), vigente
//   4. lista REAL de participantes (groupMetadata, cola de IQ por sesión)
//   5. identificar al bloqueado sin dudas (identidadParticipante.js)
//   6. no es admin/propietario; la cuenta conectada SÍ es administradora
//   7. simulación: se registra "simulado" y se detiene aquí
//      real: groupParticipantsUpdate(remove) y se lee el status POR
//      PARTICIPANTE (Baileys no lanza error si WhatsApp rechaza: devuelve
//      status 403/404/...)
//   8. verificación: se vuelve a leer la lista; solo si ya no está queda
//      "expulsado"
//
// Toda decisión queda en bloqueo_expulsiones (estado actual) y en
// bloqueo_intentos (historial).
// ==========================================================================

const os = require("os");
const crypto = require("crypto");

const repo = require("./expulsionesRepo");
const { leerConfigExpulsiones, expulsionesRealesConfirmadas, esperaParaIntento } = require("./configExpulsiones");
const identidad = require("./identidadParticipante");

const INSTANCIA = `${os.hostname()}:${process.pid}:${crypto.randomBytes(3).toString("hex")}`;

// Errores que significan "WhatsApp no está disponible ahora" (mismo
// criterio que el control de inactividad, ejecutarControlInactividad.js).
function esErrorDeConexion(err) {

    if (!err) return false;
    if (err.code === "SOCKET_NO_VIGENTE") return true;

    const texto = String(err.message || err).toLowerCase();

    return /connection closed|connection lost|socket closed|not open|timed out waiting for connection|stream errored/.test(texto);

}

function dependenciasReales() {

    const groupQueue = require("../../../services/baileys/groupQueue");
    const propiedadSesion = require("../../../services/baileys/propiedadSesion");
    const { evaluarGrupo } = require("../grupos/politicaGrupos");
    const { registrarIntentoExpulsion } = require("./bloqueadosRepo");

    return {
        repo,
        registrarIntento: registrarIntentoExpulsion,
        // Require diferido: manager -> socket -> listeners -> este módulo.
        obtenerSocket: usuarioId => require("../../../services/baileys/manager").getSocketActivoDe(usuarioId),
        puedeActuar: sock => propiedadSesion.puedeActuar(sock),
        groupMetadata: groupQueue.groupMetadata,
        groupParticipantsUpdate: groupQueue.groupParticipantsUpdate,
        evaluarGrupo,
        expulsionesReales: expulsionesRealesConfirmadas,
        ahora: () => new Date()
    };

}

function socketDelCliente(sock, usuarioId, deps) {
    return !!sock && sock.context?.usuarioId === usuarioId && deps.puedeActuar(sock);
}

// Status del participante en la respuesta de groupParticipantsUpdate:
// [{ status: '200' | '403' | '404' | ..., jid }].
function statusDe(respuesta, participanteJid) {

    if (!Array.isArray(respuesta) || respuesta.length === 0) return null;

    const objetivo = identidad.normalizarJid(participanteJid);
    const fila = respuesta.find(r => identidad.normalizarJid(r?.jid) === objetivo) || respuesta[0];

    return fila?.status != null ? String(fila.status) : null;

}

// --------------------------------------------------------------------------
// Una tarea ya tomada (estado en_curso, lease de esta instancia).
// Devuelve { estado, conexion?, error? }.
// --------------------------------------------------------------------------
async function procesarTarea({ tarea, sock, deps, config, instancia = INSTANCIA }) {

    const ahora = deps.ahora();
    const usuarioId = tarea.usuario_id;
    const grupoId = tarea.grupo_id;

    const cerrar = async (estado, { error = null, campos = {}, conexion = false, registrar = true } = {}) => {

        let proximo = null;
        let errorFinal = error;

        if (estado === "sesion_desconectada") {
            proximo = ahora;
        } else if (repo.REINTENTABLES_AUTO.includes(estado)) {
            if ((tarea.intentos || 0) < config.maxIntentos) proximo = new Date(ahora.getTime() + esperaParaIntento(tarea.intentos || 1, config));
            else errorFinal = `${error || "sin detalle"} — reintentos automáticos agotados (${tarea.intentos}); usa «Reintentar»`;
        }

        const cierre = await deps.repo.cerrarTarea(tarea, {
            estado,
            proximo_intento_en: proximo ? proximo.toISOString() : null,
            ultimo_error: errorFinal,
            session_id: sock?.context?.sessionId || tarea.session_id || null,
            ...campos
        }, { instancia, ahora });

        if (!cierre.ok) {
            console.warn(`⚠️ [EXPULSIÓN] no se pudo cerrar la tarea ${tarea.id} (${cierre.motivo || cierre.error}) — la retomará otra pasada`);
            return { estado: "lease_perdido", error: cierre.motivo || cierre.error };
        }

        if (registrar && estado !== "pendiente") {
            await deps.registrarIntento({
                bloqueadoId: tarea.bloqueado_id,
                usuarioId,
                expulsionId: tarea.id,
                grupoId,
                grupoNombre: tarea.grupo_nombre,
                resultado: estado,
                error: errorFinal,
                origen: tarea.origen || "bloqueo",
                modo: campos.modo || (deps.expulsionesReales() ? "real" : "simulacion"),
                statusWhatsapp: campos.ultimo_status || null,
                sessionId: sock?.context?.sessionId || null
            });
        }

        return { estado, conexion, error: errorFinal };

    };

    // 2. bloqueo vigente y del mismo cliente.
    const lectura = await deps.repo.leerBloqueo(tarea.bloqueado_id, usuarioId);
    if (!lectura.ok) return cerrar("pendiente", { error: `no se pudo leer el bloqueo: ${lectura.error}` });
    if (!lectura.bloqueado || !lectura.bloqueado.activo) return cerrar("cancelado", { error: "el contacto fue desbloqueado" });

    const bloqueado = lectura.bloqueado;

    const politica = await deps.evaluarGrupo(usuarioId, grupoId);
    if (!politica.permitido) {
        if (politica.motivo === "autorizacion_desconocida") return cerrar("pendiente", { error: "no se pudo leer la autorización del grupo" });
        return cerrar("cancelado", { error: "el grupo ya no está autorizado para este cliente" });
    }

    // 3. WhatsApp del MISMO cliente.
    if (!socketDelCliente(sock, usuarioId, deps)) {
        return cerrar("sesion_desconectada", { error: "no hay un WhatsApp conectado y activo para este cliente", conexion: true });
    }

    // 4. lista real.
    let metadata;

    try {
        metadata = await deps.groupMetadata(sock, grupoId);
    } catch (err) {
        if (esErrorDeConexion(err)) return cerrar("sesion_desconectada", { error: `conexión perdida: ${err.message}`, conexion: true });
        return cerrar("error_whatsapp", { error: `no se pudo leer el grupo: ${err?.message || err}` });
    }

    const participantes = Array.isArray(metadata?.participants) ? metadata.participants : [];

    if (participantes.length === 0) return cerrar("error_whatsapp", { error: "WhatsApp devolvió el grupo sin participantes" });

    // 5. identificar (excluyendo siempre a la propia cuenta conectada).
    const loc = identidad.localizarParticipante(participantes, bloqueado, { excluir: identidad.idsDeCuenta(sock) });

    if (loc.estado === "ausente") {

        const verificada = { verificada_en: ahora.toISOString() };

        // Un intento anterior ya recibió 200 de WhatsApp: ahora queda verificado.
        if (tarea.ultimo_status === "200") return cerrar("expulsado", { campos: verificada });

        const nota = tarea.ultimo_status === "enviando" ? "un intento anterior se interrumpió; verificado que ya no está" : null;

        return cerrar("ya_no_estaba", { error: nota, campos: verificada });

    }

    if (loc.estado !== "encontrado") return cerrar("identidad_ambigua", { error: loc.motivo });

    const participante = loc.participante;
    const campos = { participante_jid: participante.id, criterio_identidad: loc.criterio };

    // 6. permisos.
    if (identidad.esPropietario(participante, metadata) || identidad.esAdministrador(participante)) {
        return cerrar("no_expulsable", { error: "es administrador o propietario del grupo", campos });
    }

    const cuenta = identidad.participanteDeCuenta(participantes, sock);

    if (!cuenta || !identidad.esAdministrador(cuenta)) {
        return cerrar("sin_permisos", { error: "la cuenta de WhatsApp conectada no es administradora del grupo", campos });
    }

    // 7a. simulación: hasta aquí.
    if (!deps.expulsionesReales()) {
        return cerrar("simulado", { error: null, campos: { ...campos, modo: "simulacion" } });
    }

    // 7b. real.
    const anotado = await deps.repo.anotarEnvio(tarea, { instancia, participanteJid: participante.id, criterio: loc.criterio, sessionId: sock.context?.sessionId || null, modo: "real" });

    if (!anotado.ok) return { estado: "lease_perdido", error: anotado.motivo || anotado.error };

    let respuesta;

    try {
        respuesta = await deps.groupParticipantsUpdate(sock, grupoId, [participante.id], "remove");
    } catch (err) {
        if (esErrorDeConexion(err)) return cerrar("sesion_desconectada", { error: `conexión perdida al expulsar: ${err.message}`, conexion: true, campos: { ...campos, modo: "real", ultimo_status: "enviando" } });
        return cerrar("error_whatsapp", { error: err?.message || String(err), campos: { ...campos, modo: "real", ultimo_status: null } });
    }

    const status = statusDe(respuesta, participante.id);
    const camposReal = { ...campos, modo: "real", ultimo_status: status };

    if (status === "401" || status === "403") return cerrar("sin_permisos", { error: `WhatsApp rechazó la expulsión (${status})`, campos: camposReal });
    if (status === "404") return cerrar("ya_no_estaba", { error: "WhatsApp respondió que no estaba en el grupo (404)", campos: { ...camposReal, verificada_en: ahora.toISOString() } });
    if (status && status !== "200") return cerrar("error_whatsapp", { error: `WhatsApp respondió ${status}`, campos: camposReal });

    // 8. verificación con la lista real.
    let despues;

    try {
        despues = await deps.groupMetadata(sock, grupoId);
    } catch (err) {
        return cerrar("sin_verificar", { error: `WhatsApp aceptó la solicitud pero no se pudo releer el grupo: ${err?.message || err}`, campos: camposReal, conexion: esErrorDeConexion(err) });
    }

    if (identidad.sigueEnGrupo(despues?.participants, participante.id)) {
        return cerrar("sin_verificar", { error: `WhatsApp respondió ${status || "sin status"} pero el participante sigue en el grupo`, campos: camposReal });
    }

    return cerrar("expulsado", { campos: { ...camposReal, ultimo_status: status || "200", verificada_en: deps.ahora().toISOString() } });

}

// --------------------------------------------------------------------------
// Una pasada sobre las tareas procesables de UN cliente.
// --------------------------------------------------------------------------
async function pasada(usuarioId, { sock, bloqueadoId, config, deps }) {

    const lista = await deps.repo.listarProcesables(usuarioId, { modo: config.modo, ahora: deps.ahora(), lote: config.lote, bloqueadoId });

    if (!lista.ok) {
        if (lista.motivo === "migracion_pendiente") console.warn("⚠️ [EXPULSIÓN] falta aplicar supabase_migrations/040_bloqueo_expulsiones.sql — no se procesa nada.");
        return { ok: false, motivo: lista.motivo, procesadas: 0, resultados: [] };
    }

    if (lista.tareas.length === 0) return { ok: true, procesadas: 0, resultados: [] };

    const socket = sock || deps.obtenerSocket(usuarioId);

    if (!socketDelCliente(socket, usuarioId, deps)) {
        await deps.repo.marcarSinSesion(lista.tareas.filter(t => t.estado !== "en_curso"), "no hay un WhatsApp conectado y activo para este cliente");
        return { ok: true, procesadas: 0, sinSesion: true, resultados: [] };
    }

    const resultados = [];

    for (let i = 0; i < lista.tareas.length; i++) {

        const candidata = lista.tareas[i];

        const toma = await deps.repo.tomarTarea(candidata, { instancia: INSTANCIA, leaseSegundos: config.leaseSegundos, ahora: deps.ahora() });

        if (!toma.ok || !toma.tarea) continue; // otra instancia la tomó, o error al tomarla

        let resultado;

        try {
            resultado = await procesarTarea({ tarea: toma.tarea, sock: socket, deps, config });
        } catch (err) {
            // Defensa: un fallo inesperado no detiene los demás grupos; el
            // lease vence y la tarea se retoma.
            console.error(`❌ [EXPULSIÓN] error inesperado en ${candidata.grupo_id}:`, err?.message);
            resultado = { estado: "error_interno", error: err?.message };
        }

        resultados.push({ tareaId: candidata.id, grupoId: candidata.grupo_id, ...resultado });

        if (resultado.conexion) {
            await deps.repo.marcarSinSesion(lista.tareas.slice(i + 1).filter(t => t.estado !== "en_curso"), "se perdió la conexión de WhatsApp durante la expulsión");
            break;
        }

    }

    return { ok: true, procesadas: resultados.length, resultados };

}

// Una sola pasada en curso por cliente y proceso; si llega otra petición
// mientras corre, se hace una vuelta más al terminar (no se pierde trabajo).
const enCurso = new Map(); // usuarioId -> { otraVuelta: boolean, promesa }

async function procesarPendientesDe(usuarioId, { sock = null, bloqueadoId = null, config = leerConfigExpulsiones(), deps = null } = {}) {

    if (!usuarioId) return { ok: false, motivo: "sin_usuario" };
    if (config.modo === "desactivado") return { ok: false, motivo: "desactivado" };

    const actual = enCurso.get(usuarioId);

    if (actual) {
        actual.otraVuelta = true;
        return { ok: true, encolado: true, promesa: actual.promesa };
    }

    const d = deps || dependenciasReales();
    const estado = { otraVuelta: false, promesa: null };

    enCurso.set(usuarioId, estado);

    estado.promesa = (async () => {

        const todos = [];
        let vueltas = 0;

        try {

            do {
                estado.otraVuelta = false;
                const r = await pasada(usuarioId, { sock, bloqueadoId: vueltas === 0 ? bloqueadoId : null, config, deps: d });
                todos.push(...(r.resultados || []));
                if (!r.ok) return { ...r, resultados: todos };
                vueltas++;
            } while (estado.otraVuelta && vueltas < 5);

            return { ok: true, procesadas: todos.length, resultados: todos };

        } finally {
            enCurso.delete(usuarioId);
        }

    })();

    return estado.promesa;

}

// Para las rutas: dispara el procesamiento sin hacer esperar al panel.
function procesarEnSegundoPlano(usuarioId, opciones = {}) {

    const config = opciones.config || leerConfigExpulsiones();

    if (config.modo === "desactivado") return false;

    setImmediate(() => {
        procesarPendientesDe(usuarioId, { ...opciones, config })
            .catch(err => console.error("❌ [EXPULSIÓN] error en segundo plano:", err?.message));
    });

    return true;

}

module.exports = {
    INSTANCIA,
    esErrorDeConexion,
    statusDe,
    procesarTarea,
    procesarPendientesDe,
    procesarEnSegundoPlano
};
