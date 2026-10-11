// ==========================================================================
// ejecutarControlInactividad.js — UNA ejecución del control de 15 días sin
// compra confirmada, para el tenant dueño del socket.
//
//   1. Candado: en memoria (mismo proceso) + fila 'en_curso' en
//      inactividad_ejecuciones (índice único parcial -> entre procesos).
//   2. Sincroniza compras confirmadas (estado='pagado') de las tablas de los
//      sorteos del tenant hacia inactividad_miembros (solo avanza fechas).
//   3. Por cada grupo comercial (eventos_bot del tenant): lee los
//      participantes reales (groupMetadata, por la cola de IQ), resuelve la
//      identidad de cada uno SIN escribir "usuarios", actualiza su
//      seguimiento y decide con evaluarMiembro().
//   4. SIMULACIÓN: registra qué se haría. REAL (solo con confirmación
//      explícita, ver configInactividad.js): vuelve a leer el grupo, verifica
//      que el candidato siga ahí y que el bot siga siendo admin, y expulsa
//      uno a uno con tope por ejecución y reintentos solo ante fallos
//      transitorios.
//   5. Bitácora completa en inactividad_evaluaciones + resumen en la fila de
//      la ejecución. Nunca lanza.
// ==========================================================================

const repo = require("./inactividadRepo");
const { evaluarMiembro } = require("./evaluarMiembro");
const { leerConfigInactividad, idPlano } = require("./configInactividad");
const { enmascararJid } = require("../../utils/enmascararJid");

// Dependencias externas inyectables (las pruebas las reemplazan).
function dependenciasReales() {

    const groupQueue = require("../../../services/baileys/groupQueue");
    const { resolverIdentidadExistente } = require("../usuarios/obtenerUsuarioGlobal");
    const { extraerCandidatos } = require("../bloqueo/bloqueoParticipantesGrupo");
    const { esCuentaIgnorada } = require("../mensajes/cuentasIgnoradas");

    return {
        groupMetadata: groupQueue.groupMetadata,
        groupParticipantsUpdate: groupQueue.groupParticipantsUpdate,
        resolverIdentidadExistente,
        extraerCandidatos,
        esCuentaIgnorada,
        dormir: ms => new Promise(res => setTimeout(res, ms)),
        // Segunda barrera: se relee el ENTORNO en el momento de expulsar,
        // ignorando el objeto config que haya recibido la ejecución.
        expulsionesConfirmadas: () => leerConfigInactividad().modo === "real"
    };

}

const enCursoPorTenant = new Set();

const SIN_CONFIRMACION = "expulsiones no confirmadas en el entorno (INACTIVIDAD_MODO=real + INACTIVIDAD_CONFIRMAR_EXPULSIONES=SI)";

// Errores que significan "WhatsApp no está disponible ahora": se corta la
// ejecución entera (no tiene sentido seguir intentando con un socket caído)
// y la siguiente ejecución lo reintenta.
function esErrorDeConexion(err) {

    if (!err) return false;
    if (err.code === "SOCKET_NO_VIGENTE") return true;

    const texto = String(err.message || err).toLowerCase();

    return /connection closed|connection lost|socket closed|not open|timed out waiting for connection|stream errored/.test(texto);

}

function idsDeParticipante(p, candidatos) {

    return new Set(
        [p?.id, p?.lid, p?.phoneNumber, candidatos.jid, candidatos.telefono, candidatos.lid]
            .map(idPlano)
            .filter(Boolean)
    );

}

function interseca(a, b) {
    for (const x of a) if (b.has(x)) return true;
    return false;
}

function filaBitacora({ ejecucionId, usuarioId, modo, grupo, miembroJid = null, usuarioGlobalId = null, decision }) {

    return {
        ejecucion_id: ejecucionId,
        usuario_id: usuarioId,
        modo,
        grupo_id: grupo.grupo_id,
        grupo_nombre: grupo.grupo_nombre || null,
        usuario_global_id: usuarioGlobalId,
        miembro_jid: miembroJid,
        ultima_compra_en: decision.ultimaCompra ? decision.ultimaCompra.toISOString() : null,
        referencia_en: decision.referencia ? decision.referencia.toISOString() : null,
        dias_sin_compra: Number.isInteger(decision.diasSinCompra) ? decision.diasSinCompra : null,
        cumple_plazo_en: decision.cumplePlazoEn ? decision.cumplePlazoEn.toISOString() : null,
        decision: decision.decision,
        motivo: decision.motivo,
        accion: decision.accion || "ninguna",
        resultado: decision.resultado || "no_aplica",
        error: decision.error || null,
        intentos: decision.intentos || 0
    };

}

// --------------------------------------------------------------------------
// Sincronización de compras confirmadas visibles en las tablas.
// --------------------------------------------------------------------------
async function sincronizarCompras(usuarioId, grupos) {

    const { compras, errores } = await repo.comprasConfirmadasDesdeTablas(usuarioId, grupos.map(g => g.tabla));

    // Una sola escritura por (grupo, miembro): la compra más reciente.
    const masReciente = new Map();

    for (const c of compras) {
        const clave = `${c.grupoId}::${c.usuarioGlobalId}`;
        const actual = masReciente.get(clave);
        if (!actual || c.fecha > actual.fecha) masReciente.set(clave, c);
    }

    let registradas = 0;
    let sinReferencia = 0;

    for (const c of masReciente.values()) {
        const r = await repo.registrarCompraConfirmada({ usuarioId, ...c, origen: "tabla_pagado" });
        if (r.ok) registradas++;
        else if (r.motivo === "referencia_inexistente") sinReferencia++;
    }

    return { encontradas: compras.length, miembros: masReciente.size, registradas, sinReferencia, errores };

}

// --------------------------------------------------------------------------
// Expulsión de UN candidato, con verificación y reintentos.
// --------------------------------------------------------------------------
async function expulsar({ sock, deps, config, grupoId, candidato }) {

    let intentos = 0;
    let ultimoError = null;

    while (intentos <= config.reintentos) {

        intentos++;

        // Barrera final, inmediatamente antes de la única llamada de
        // expulsión del módulo: sin INACTIVIDAD_MODO=real +
        // INACTIVIDAD_CONFIRMAR_EXPULSIONES=SI en el entorno, no se expulsa.
        if (typeof deps.expulsionesConfirmadas !== "function" || deps.expulsionesConfirmadas() !== true) {
            return { resultado: "suspendido", intentos: 0, error: SIN_CONFIRMACION };
        }

        try {

            const respuesta = await deps.groupParticipantsUpdate(sock, grupoId, [candidato.jid], "remove");
            const status = String((Array.isArray(respuesta) ? respuesta[0]?.status : null) ?? "200");

            if (status === "200") return { resultado: "expulsado", intentos };
            if (status === "404") return { resultado: "ya_no_estaba", intentos };
            if (status === "401" || status === "403") return { resultado: "sin_permisos", intentos, error: `WhatsApp respondió ${status}` };

            ultimoError = `WhatsApp respondió ${status}`;

        } catch (err) {

            if (esErrorDeConexion(err)) {
                const error = new Error(err?.message || String(err));
                error.conexion = true;
                error.intentos = intentos;
                throw error;
            }

            ultimoError = err?.message || String(err);

        }

        if (intentos <= config.reintentos) await deps.dormir(2000 * intentos);

    }

    return { resultado: "error", intentos, error: ultimoError };

}

// --------------------------------------------------------------------------
// Un grupo.
// --------------------------------------------------------------------------
async function procesarGrupo({ sock, deps, config, usuarioId, ejecucionId, grupo, ahora, botIds, contadores, expulsionesSuspendidas = null, inicioMs = Date.now() }) {

    const modo = config.modo;
    const bitacora = [];
    const candidatos = [];
    const grupoId = grupo.grupo_id;

    let metadata;

    try {
        metadata = await deps.groupMetadata(sock, grupoId);
    } catch (err) {
        if (esErrorDeConexion(err)) throw err;
        bitacora.push(filaBitacora({ ejecucionId, usuarioId, modo, grupo, decision: { decision: "error_grupo", motivo: "metadata_no_disponible", error: err?.message } }));
        await repo.registrarEvaluaciones(bitacora);
        return { grupoId, grupoNombre: grupo.grupo_nombre, error: err?.message, evaluados: 0, candidatos };
    }

    const participantes = Array.isArray(metadata?.participants) ? metadata.participants : [];

    if (!participantes.length) {
        bitacora.push(filaBitacora({ ejecucionId, usuarioId, modo, grupo, decision: { decision: "error_grupo", motivo: "grupo_sin_participantes_en_metadata" } }));
        await repo.registrarEvaluaciones(bitacora);
        return { grupoId, grupoNombre: grupo.grupo_nombre, error: "sin participantes", evaluados: 0, candidatos };
    }

    const seguimientos = await repo.seguimientosDelGrupo(usuarioId, grupoId);

    if (!seguimientos.ok) {
        bitacora.push(filaBitacora({ ejecucionId, usuarioId, modo, grupo, decision: { decision: "error_grupo", motivo: "seguimiento_no_disponible", error: seguimientos.error } }));
        await repo.registrarEvaluaciones(bitacora);
        return { grupoId, grupoNombre: grupo.grupo_nombre, error: seguimientos.error, evaluados: 0, candidatos };
    }

    const porMiembro = new Map(seguimientos.filas.map(f => [f.usuario_global_id, f]));
    const ownerIds = new Set([metadata.owner, metadata.ownerPn].map(idPlano).filter(Boolean));

    const botParticipante = participantes.find(p => interseca(idsDeParticipante(p, deps.extraerCandidatos(p)), botIds));
    const botEsAdmin = botParticipante?.admin === "admin" || botParticipante?.admin === "superadmin";

    const vistos = new Set();

    for (const p of participantes) {

        const cand = deps.extraerCandidatos(p);
        const ids = idsDeParticipante(p, cand);

        const esCuentaBot = interseca(ids, botIds);
        const esPropietario = interseca(ids, ownerIds);
        const esProtegido = interseca(ids, config.protegidos) || !!deps.esCuentaIgnorada({
            message: { key: { participant: p?.id || cand.jid, participantAlt: p?.phoneNumber || p?.lid || null } }
        });

        const excluidoAntesDeIdentidad = esCuentaBot || esPropietario || p?.admin === "admin" || p?.admin === "superadmin" || esProtegido;

        let identidad = { estado: "datos_insuficientes" };

        // También se resuelve la identidad de los excluidos (admins, dueño):
        // no para evaluarlos, sino para no marcarlos "ausentes" por error.
        if (cand.jid && (cand.telefono || cand.lid)) {

            try {
                const { conflicto, usuario } = await deps.resolverIdentidadExistente({ telefono: cand.telefono, lid: cand.lid });
                if (conflicto) identidad = { estado: "ambigua" };
                else if (!usuario?.id) identidad = { estado: "no_registrada" };
                else if ((cand.telefono && cand.lid) || (usuario.telefono && usuario.lid)) identidad = { estado: "ok", usuarioGlobalId: usuario.id };
                else identidad = { estado: "incompleta", usuarioGlobalId: usuario.id };
            } catch (err) {
                identidad = { estado: "ambigua", error: err?.message };
            }

        }

        // Dos entradas del mismo participante (LID y teléfono) -> una sola
        // evaluación.
        if (identidad.usuarioGlobalId && vistos.has(identidad.usuarioGlobalId)) continue;
        if (identidad.usuarioGlobalId) vistos.add(identidad.usuarioGlobalId);

        let seguimiento = identidad.estado === "ok" ? porMiembro.get(identidad.usuarioGlobalId) || null : null;
        let seguimientoNuevo = false;
        let reingreso = false;

        if (identidad.estado === "ok" && !excluidoAntesDeIdentidad) {

            if (!seguimiento) {

                const creado = await repo.crearSeguimiento({ usuarioId, grupoId, usuarioGlobalId: identidad.usuarioGlobalId, ahora });
                seguimiento = creado.fila;
                seguimientoNuevo = !!creado.fila && !creado.fila.ultima_compra_en;

            } else if (seguimiento.presente === false) {

                // Salió y volvió a entrar: el plazo empieza de nuevo.
                seguimiento = { ...seguimiento, seguimiento_desde: ahora.toISOString(), presente: true };
                reingreso = true;

            }

        }

        const decision = evaluarMiembro({
            esCuentaBot,
            esPropietario,
            rolAdmin: p?.admin || null,
            esProtegido,
            identidad,
            seguimiento,
            seguimientoNuevo,
            reingreso,
            ahora,
            dias: config.dias
        });

        if (seguimiento?.id) {

            await repo.actualizarSeguimiento(seguimiento.id, {
                presente: true,
                ultima_vez_visto_en: ahora.toISOString(),
                ultima_evaluacion_en: ahora.toISOString(),
                ultimo_resultado: `${decision.decision}:${decision.motivo}`,
                ...(reingreso ? { seguimiento_desde: ahora.toISOString() } : {})
            });

        }

        const registro = {
            jid: p?.id || cand.jid || null,
            usuarioGlobalId: identidad.estado === "ok" || identidad.estado === "incompleta" ? identidad.usuarioGlobalId : null,
            seguimientoId: seguimiento?.id || null,
            decision
        };

        if (decision.decision === "candidato") {
            decision.accion = modo === "real" ? "expulsar" : "expulsar_simulado";
            decision.resultado = modo === "real" ? "pendiente" : "simulado";
            candidatos.push(registro);
        }

        contadores[decision.decision] = (contadores[decision.decision] || 0) + 1;

        bitacora.push(registro);

    }

    // Quien tenía seguimiento y ya no aparece en el grupo -> ausente (si
    // vuelve, su plazo empieza de cero).
    for (const fila of seguimientos.filas) {
        if (fila.presente !== false && !vistos.has(fila.usuario_global_id)) {
            await repo.actualizarSeguimiento(fila.id, { presente: false });
        }
    }

    // ---------------------------------------------------- modo real ---
    let errorConexion = null;

    const confirmadas = typeof deps.expulsionesConfirmadas === "function" && deps.expulsionesConfirmadas() === true;
    const suspension = expulsionesSuspendidas || (confirmadas ? null : "sin_confirmacion_en_entorno");

    const puedeExpulsar = modo === "real" && candidatos.length > 0 && botEsAdmin && !suspension;

    if (modo === "real" && candidatos.length && !puedeExpulsar) {

        const error = suspension === "sin_confirmacion_en_entorno"
            ? SIN_CONFIRMACION
            : suspension
                ? `expulsiones suspendidas en esta ejecución: ${suspension}`
                : "el bot no es administrador del grupo";

        for (const c of candidatos) {
            Object.assign(c.decision, { accion: "ninguna", resultado: suspension ? "suspendido" : "sin_permisos", error });
        }

    }

    // La bitácora se guarda ANTES de expulsar (candidatos en "pendiente"):
    // si el proceso muere a mitad, queda constancia de qué se iba a hacer.
    const { ids } = await repo.registrarEvaluaciones(bitacora.map(b => filaBitacora({
        ejecucionId, usuarioId, modo, grupo,
        miembroJid: b.jid, usuarioGlobalId: b.usuarioGlobalId, decision: b.decision
    })));

    bitacora.forEach((b, i) => { b.evaluacionId = ids?.[i] || null; });

    if (puedeExpulsar) {

        try {
            await ejecutarExpulsiones({ sock, deps, config, grupoId, candidatos, contadores, botIds, ahora, inicioMs });
        } catch (err) {
            errorConexion = err;
        }

    }

    const resultadoGrupo = {
        grupoId,
        grupoNombre: grupo.grupo_nombre,
        botEsAdmin,
        evaluados: bitacora.length,
        // Quienes cumplirían el plazo próximamente si no compran (informe).
        proximos: bitacora
            .filter(b => b.decision.decision === "conservar" && b.decision.cumplePlazoEn)
            .map(b => ({ miembroJid: b.jid, usuarioGlobalId: b.usuarioGlobalId, cumplePlazoEn: b.decision.cumplePlazoEn, motivo: b.decision.motivo }))
            .sort((a, b) => a.cumplePlazoEn - b.cumplePlazoEn),
        candidatos: candidatos.map(c => ({
            grupoId,
            grupoNombre: grupo.grupo_nombre,
            miembroJid: c.jid,
            usuarioGlobalId: c.usuarioGlobalId,
            ultimaCompra: c.decision.ultimaCompra || null,
            diasSinCompra: c.decision.diasSinCompra,
            motivo: c.decision.motivo,
            accion: c.decision.accion,
            resultado: c.decision.resultado,
            error: c.decision.error || null
        }))
    };

    if (errorConexion) {
        errorConexion.grupoParcial = resultadoGrupo;
        throw errorConexion;
    }

    return resultadoGrupo;

}

// Campos de la bitácora que cambian tras intentar la expulsión.
function camposResultado(decision) {
    return {
        decision: decision.decision,
        motivo: decision.motivo,
        accion: decision.accion || "ninguna",
        resultado: decision.resultado || "no_aplica",
        error: decision.error || null,
        intentos: decision.intentos || 0
    };
}

async function ejecutarExpulsiones({ sock, deps, config, grupoId, candidatos, contadores, botIds, ahora = new Date(), inicioMs = Date.now() }) {

    const cerrar = async (c, campos) => {
        Object.assign(c.decision, campos);
        await repo.actualizarEvaluacion(c.evaluacionId, camposResultado(c.decision));
    };

    // Lectura FRESCA justo antes de expulsar: el candidato debe seguir en el
    // grupo, no haberse vuelto admin, y el bot debe seguir siendo admin.
    let fresca;

    try {
        fresca = await deps.groupMetadata(sock, grupoId);
    } catch (err) {
        if (esErrorDeConexion(err)) {
            for (const c of candidatos) await cerrar(c, { resultado: "error", error: `conexión perdida: ${err?.message}` });
            throw err;
        }
        for (const c of candidatos) await cerrar(c, { resultado: "error", error: `verificación previa falló: ${err?.message}` });
        return;
    }

    const participantesFrescos = fresca?.participants || [];
    const actuales = new Map();

    for (const p of participantesFrescos) {
        for (const id of idsDeParticipante(p, deps.extraerCandidatos(p))) actuales.set(id, p);
    }

    const bot = participantesFrescos.find(p => interseca(idsDeParticipante(p, deps.extraerCandidatos(p)), botIds));

    if (bot?.admin !== "admin" && bot?.admin !== "superadmin") {
        for (const c of candidatos) await cerrar(c, { accion: "ninguna", resultado: "sin_permisos", error: "el bot ya no es administrador del grupo" });
        return;
    }

    // Tiempo máximo para expulsar: la mitad de la vida del candado, para que
    // otra instancia nunca pueda tomarlo (vencido) mientras esta sigue.
    const limiteMs = config.lockMinutos * 60 * 1000 * 0.5;

    for (let i = 0; i < candidatos.length; i++) {

        const c = candidatos[i];
        const actual = actuales.get(idPlano(c.jid));

        if (!actual) {
            await cerrar(c, { resultado: "ya_no_estaba" });
            if (c.seguimientoId) await repo.actualizarSeguimiento(c.seguimientoId, { presente: false, ultimo_resultado: "candidato:ya_no_estaba" });
            continue;
        }

        if (actual.admin === "admin" || actual.admin === "superadmin") {
            await cerrar(c, { decision: "excluido", motivo: "administrador", accion: "ninguna", resultado: "no_aplica" });
            continue;
        }

        if ((contadores.expulsados || 0) >= config.maxExpulsiones) {
            await cerrar(c, { resultado: "limite_alcanzado" });
            continue;
        }

        if (Date.now() - inicioMs > limiteMs) {
            await cerrar(c, { resultado: "tiempo_agotado", error: "la ejecución superó su tiempo máximo; se reintenta en la próxima" });
            continue;
        }

        // Revalidación contra la base de datos: una compra confirmada durante
        // esta ejecución (trigger del pago o sticker) lo saca de candidatos.
        // Si no se puede releer, NO se expulsa.
        const fresco = c.seguimientoId ? await repo.obtenerSeguimiento(c.seguimientoId) : { ok: false };

        if (!fresco.ok || !fresco.fila) {
            await cerrar(c, { resultado: "error", error: `revalidación fallida: ${fresco.error || "seguimiento no encontrado"}` });
            continue;
        }

        const revalidado = evaluarMiembro({
            identidad: { estado: "ok", usuarioGlobalId: c.usuarioGlobalId },
            seguimiento: fresco.fila,
            ahora,
            dias: config.dias
        });

        if (revalidado.decision !== "candidato") {
            await cerrar(c, { decision: revalidado.decision, motivo: `revalidado:${revalidado.motivo}`, accion: "ninguna", resultado: "no_aplica" });
            continue;
        }

        try {

            const r = await expulsar({ sock, deps, config, grupoId, candidato: c });

            await cerrar(c, { resultado: r.resultado, intentos: r.intentos, error: r.error || null });

            if (r.resultado === "expulsado") {

                contadores.expulsados = (contadores.expulsados || 0) + 1;

                await repo.actualizarSeguimiento(c.seguimientoId, {
                    presente: false,
                    expulsado_en: new Date().toISOString(),
                    ultimo_resultado: "candidato:expulsado"
                });

            }

        } catch (err) {

            // Conexión perdida: este y los que faltan quedan sin ejecutar; la
            // próxima ejecución los vuelve a evaluar desde cero.
            for (const pendiente of candidatos.slice(i)) {
                await cerrar(pendiente, { resultado: "error", error: `conexión perdida: ${err?.message}`, intentos: pendiente === c ? err.intentos || 1 : 0 });
            }

            throw err;

        }

    }

}


// --------------------------------------------------------------------------
// Informe legible (consola / PM2). El identificador completo del miembro
// queda en inactividad_evaluaciones (solo backend); aquí va enmascarado.
// --------------------------------------------------------------------------
function formatearInforme(informe) {

    const lineas = [];

    lineas.push("==================================================");
    lineas.push(`🧹 CONTROL DE INACTIVIDAD — modo ${String(informe.modo).toUpperCase()} — ${informe.dias} días`);
    lineas.push(`   ejecución: ${informe.ejecucionId || "(sin registrar)"} | estado: ${informe.estado}`);

    if (informe.sincronizacion) {
        lineas.push(`   compras confirmadas sincronizadas: ${informe.sincronizacion.registradas}/${informe.sincronizacion.miembros} miembros`);
    }

    for (const g of informe.grupos || []) {

        lineas.push("--------------------------------------------------");
        lineas.push(`👥 ${g.grupoNombre || "(sin nombre)"} ${enmascararJid(g.grupoId)} — evaluados: ${g.evaluados}${g.error ? ` — ERROR: ${g.error}` : ""}${g.botEsAdmin === false ? " — ⚠ el bot NO es admin" : ""}`);

        if (g.proximos?.length) {
            const primeros = g.proximos.slice(0, 5)
                .map(p => `${enmascararJid(p.miembroJid)} el ${new Date(p.cumplePlazoEn).toISOString().slice(0, 10)}`)
                .join(", ");
            lineas.push(`   próximos a cumplir el plazo (${g.proximos.length}): ${primeros}${g.proximos.length > 5 ? ", …" : ""}`);
        }

        if (!g.candidatos.length) {
            lineas.push("   sin candidatos");
            continue;
        }

        for (const c of g.candidatos) {
            const compra = c.ultimaCompra ? new Date(c.ultimaCompra).toISOString().slice(0, 10) : "nunca (en seguimiento)";
            lineas.push(`   • ${enmascararJid(c.miembroJid)} [${c.usuarioGlobalId}] última compra: ${compra} | ${c.diasSinCompra} días | ${c.motivo} | acción: ${c.accion} -> ${c.resultado}${c.error ? ` (${c.error})` : ""}`);
        }

    }

    lineas.push("--------------------------------------------------");
    lineas.push(`Resumen: ${JSON.stringify(informe.resumen || {})}`);
    lineas.push("==================================================");

    return lineas.join("\n");

}

// --------------------------------------------------------------------------
// Punto de entrada.
// --------------------------------------------------------------------------
async function ejecutarControlInactividad({ sock, config = leerConfigInactividad(), ahora = new Date(), deps = null } = {}) {

    const usuarioId = sock?.context?.usuarioId || null;
    const sessionId = sock?.context?.sessionId || null;

    if (!usuarioId) return { ok: false, motivo: "sin_tenant" };
    if (config.modo === "desactivado") return { ok: false, motivo: "desactivado" };

    if (enCursoPorTenant.has(usuarioId)) return { ok: false, motivo: "otra_ejecucion_en_curso" };

    enCursoPorTenant.add(usuarioId);

    const d = deps || dependenciasReales();

    try {

        if (config.avisoModo) console.warn(`⚠️ [INACTIVIDAD] ${config.avisoModo}`);

        const candado = await repo.tomarEjecucion({ usuarioId, sessionId, modo: config.modo, lockMinutos: config.lockMinutos, ahora });

        if (!candado.ok) {
            console.log(`⏭️ [INACTIVIDAD] no se ejecuta: ${candado.motivo}${candado.error ? ` (${candado.error})` : ""}`);
            return { ok: false, motivo: candado.motivo };
        }

        const ejecucionId = candado.ejecucion.id;
        const contadores = {};
        const inicioMs = Date.now();
        const informe = { ok: true, ejecucionId, modo: config.modo, dias: config.dias, estado: "en_curso", grupos: [] };

        try {

            const { ok: okGrupos, grupos: todos, error: errorGrupos } = await repo.gruposComerciales(usuarioId);

            if (!okGrupos) throw new Error(`no se pudieron leer los grupos comerciales: ${errorGrupos}`);

            const grupos = config.gruposPermitidos.length
                ? todos.filter(g => config.gruposPermitidos.includes(g.grupo_id))
                : todos;

            informe.sincronizacion = await sincronizarCompras(usuarioId, grupos);

            // Fail-safe: si alguna compra de las tablas no se pudo leer o
            // registrar, la "última compra" de algún miembro podría estar
            // atrasada -> en esta ejecución NO se expulsa a nadie (sigue
            // evaluando y registrando, como una simulación).
            const sinc = informe.sincronizacion;
            const expulsionesSuspendidas = config.modo === "real" && (sinc.errores.length > 0 || sinc.registradas + sinc.sinReferencia < sinc.miembros)
                ? "sincronizacion_de_compras_incompleta"
                : null;

            if (expulsionesSuspendidas) {
                informe.expulsionesSuspendidas = expulsionesSuspendidas;
                console.warn(`⚠️ [INACTIVIDAD] expulsiones suspendidas en esta ejecución: ${expulsionesSuspendidas} (${JSON.stringify(sinc.errores)})`);
            }

            const botIds = new Set([sock?.user?.id, sock?.user?.lid, sock?.user?.phoneNumber].map(idPlano).filter(Boolean));

            for (const grupo of grupos) {
                informe.grupos.push(await procesarGrupo({ sock, deps: d, config, usuarioId, ejecucionId, grupo, ahora, botIds, contadores, expulsionesSuspendidas, inicioMs }));
            }

            informe.estado = "completada";

        } catch (err) {

            if (err?.grupoParcial) informe.grupos.push(err.grupoParcial);

            informe.ok = false;
            informe.estado = "fallida";
            informe.error = err?.message || String(err);
            console.error("❌ [INACTIVIDAD] ejecución interrumpida:", informe.error);

        }

        informe.candidatos = informe.grupos.flatMap(g => g.candidatos);

        informe.resumen = {
            grupos: informe.grupos.length,
            gruposConError: informe.grupos.filter(g => g.error).length,
            evaluados: informe.grupos.reduce((n, g) => n + (g.evaluados || 0), 0),
            candidatos: informe.candidatos.length,
            expulsados: contadores.expulsados || 0,
            conservar: contadores.conservar || 0,
            excluidos: contadores.excluido || 0,
            omitidos: contadores.omitido || 0,
            comprasSincronizadas: informe.sincronizacion?.registradas || 0,
            expulsionesSuspendidas: informe.expulsionesSuspendidas || null
        };

        await repo.finalizarEjecucion(ejecucionId, { estado: informe.estado, resumen: informe.resumen, error: informe.error || null });

        if (config.retencionDias > 0) await repo.purgarEvaluacionesAntiguas(usuarioId, config.retencionDias, ahora);

        console.log(formatearInforme(informe));

        return informe;

    } catch (err) {

        console.error("❌ [INACTIVIDAD] error inesperado:", err?.message);
        return { ok: false, motivo: "error_interno", error: err?.message };

    } finally {

        enCursoPorTenant.delete(usuarioId);

    }

}

module.exports = {
    ejecutarControlInactividad,
    formatearInforme,
    esErrorDeConexion
};
