// ==========================================================================
// sorteos/publicador.js — worker de sorteos programados desde el panel.
//
// Cada ciclo (30 s), para el cliente dueño del socket activo:
//   1. PUBLICA los sorteos confirmados cuya hora llegó, grupo por grupo:
//      guarda el evento con guardarEvento.js (la MISMA fila de eventos_bot
//      que crea el detector: reservas, pagos, cierre automático y contadores
//      funcionan igual), abre el grupo y envía el anuncio.
//   2. Envía los RECORDATORIOS y el AVISO DE CIERRE configurados.
//   3. Libera reservas vencidas SOLO si el sorteo lo activó explícitamente.
//
// Garantías:
//   - Nunca publica una versión no confirmada (confirmado_version = version).
//   - Cada grupo se "reclama" con un UPDATE condicionado: dos ciclos o dos
//     procesos nunca publican el mismo grupo a la vez.
//   - Cada mensaje pasa por executionGuard (clave única en
//     automation_actions): como mucho UNA vez. Si un envío falla o no se
//     sabe si llegó, el grupo queda en 'requiere_revision' y solo el
//     administrador puede pedir reintentarlo (nunca un reenvío automático).
//   - Nunca publica encima de otro sorteo activo ni sobre una tabla ocupada.
// ==========================================================================

const repo = require("./repo");
const { revisarTabla, revisarGrupo } = require("./disponibilidad");
const { mensajePublicacion, mensajeRecordatorio, mensajeAvisoCierre } = require("./mensajes");
const { partesBogota } = require("./validar");
const { decidirRecordatoriosSegunEstado } = require("../automation/eventRules");
const { leerEstadoParaRecordatorios } = require("../automation/repo/estadoSorteo");

const MAX_INTENTOS_AUTOMATICOS = 5;
const VENTANA_RECORDATORIO_MS = 10 * 60 * 1000;

// Campos que limpia una liberación: los MISMOS que el botón "Liberar" del
// panel (frontend/services/tablas/liberarNumero.ts).
const CAMPOS_LIBERACION = {
    estado: "libre", comprador: null, contacto: null, contacto_lower: null, nombre: null, telefono: null,
    lib: null, grupo_id: null, grupo_nombre: null, evento_id: null, nombre_evento: null,
    fecha_reserva: null, hora_reserva: null, fecha_pago: null, hora_pago: null,
    temporal_por: null, bloqueado_hasta: null, usuario_global_id: null
};

function dependenciasReales() {
    return {
        supabase: require("../lib/supabase"),
        guardarEvento: require("../bot/funciones/eventos/guardarEvento").guardarEvento,
        consultarEvento: require("../bot/funciones/eventos/consultarEvento").consultarEvento,
        abrirGrupo: require("../bot/funciones/eventos/grupos/abrirGrupo").abrirGrupo,
        sendMessage: require("../services/baileys/send").sendMessage,
        ejecutarUnaVez: require("../automation/executionGuard").ejecutarUnaVez,
        actualizarEvento: require("../bot/funciones/reservas/actualizarEvento").actualizarEvento,
        puedeActuar: require("../services/baileys/propiedadSesion").puedeActuar,
        leerEstadoParaRecordatorios
    };
}

// "YYYY-MM-DD" + "HH:MM[:SS]" en hora de Colombia (UTC-5, sin horario de
// verano) -> Date.
function instanteBogota(fecha, hora) {
    if (!fecha || !hora) return null;
    const h = String(hora).length === 5 ? `${hora}:00` : String(hora).slice(0, 8);
    const d = new Date(`${fecha}T${h}-05:00`);
    return Number.isNaN(d.getTime()) ? null : d;
}

// ------------------------------------------------------------ publicar ---

async function publicarEnGrupo({ sock, sorteo, grupo, autorizados, deps, ahora }) {

    const usuarioId = sorteo.usuario_id;
    const grupoId = grupo.grupo_id;
    const config = sorteo.config;
    const programado = partesBogota(new Date(sorteo.publicar_en));
    const actual = partesBogota(ahora);

    // Nunca se publica fuera de su día ni después de su hora de cierre: el
    // cierre por hora compara solo la hora del día y lo cerraría al instante.
    if (actual.fecha !== programado.fecha) {
        return { estado: "requiere_revision", ultimo_error: `La fecha programada (${programado.fecha}) ya pasó; no se publicó.` };
    }
    if (config.hora_cierre && actual.hora >= config.hora_cierre) {
        return { estado: "requiere_revision", ultimo_error: `La hora de cierre (${config.hora_cierre}) ya pasó; no se publicó.` };
    }

    const rg = await revisarGrupo({ usuarioId, grupoId, identidad: sorteo.identidad_evento_real, autorizados });
    if (rg.bloqueo) return { estado: "requiere_revision", ultimo_error: rg.bloqueo };

    const rt = await revisarTabla({ usuarioId, tabla: sorteo.tabla, cifras: sorteo.cifras, cantidad: sorteo.cantidad_numeros, identidad: sorteo.identidad_evento_real });
    if (rt.bloqueos.length) return { estado: "requiere_revision", ultimo_error: rt.bloqueos.join(" ") };

    const eventoAnterior = await deps.consultarEvento(grupoId);

    const guardado = await deps.guardarEvento({
        sock,
        grupoId,
        evento: {
            nombre: config.nombre,
            hora: config.hora_fin,
            horaCierre: config.hora_cierre,
            valor: config.valor,
            premios: config.premios || [],
            tabla: sorteo.tabla,
            cifras: sorteo.cifras,
            cantidad_numeros: sorteo.cantidad_numeros
        },
        eventoAnterior,
        sorteoVigente: { identidad_evento_real: sorteo.identidad_evento_real, fecha_evento: programado.fecha }
    });

    if (!guardado?.id) return { estado: "fallido", ultimo_error: "No se pudo guardar el evento; se reintentará." };

    // Si WhatsApp no confirma la apertura, el worker de eventos la reintenta
    // (abierto=false, mismo mecanismo que la detección).
    const abierto = await deps.abrirGrupo({ sock, grupoId });
    if (!abierto) await deps.supabase.from("eventos_bot").update({ abierto: false }).eq("id", guardado.id);

    const { texto } = mensajePublicacion(config, sorteo.cuentas_snapshot, { fecha: programado.fecha });

    const envio = await deps.ejecutarUnaVez({
        claveIdempotencia: `sorteo:${sorteo.id}:grupo:${grupoId}:publicacion:${Number(grupo.reintentos_manuales) || 0}`,
        grupoId,
        usuarioId,
        tipoAccion: "SORTEO_PUBLICACION",
        ejecutar: () => deps.sendMessage({ sock, jid: grupoId, text: texto })
    });

    const base = { evento_bot_id: guardado.id };

    if (envio.ejecutada || envio.motivo === "ya_ok") {
        return { ...base, estado: "publicado", version_publicada: sorteo.version, publicado_en: new Date().toISOString(), ultimo_error: null };
    }

    // El registro de idempotencia no se pudo crear: el anuncio NO se envió.
    if (envio.motivo === "error_insert") {
        return { ...base, estado: "fallido", ultimo_error: "No se pudo registrar el envío; se reintentará." };
    }

    // Falló el envío, o un intento anterior quedó a medias: no se sabe con
    // certeza si llegó. Nunca se reenvía solo.
    return {
        ...base,
        estado: "requiere_revision",
        ultimo_error: envio.motivo === "fallo_ejecucion"
            ? `El anuncio no se pudo enviar: ${envio.error?.message || envio.error}`
            : `Estado del anuncio incierto (${envio.motivo}); revisa el grupo antes de reintentar.`
    };

}

async function finalizarSorteo(usuarioId, sorteoId) {

    const grupos = await repo.gruposDelSorteo(usuarioId, sorteoId);
    if (!grupos.ok) return;

    const lista = grupos.data;
    const enCurso = lista.some(g => g.estado === "pendiente" || g.estado === "publicando" ||
        (g.estado === "fallido" && (Number(g.intentos) || 0) < MAX_INTENTOS_AUTOMATICOS));

    if (enCurso) return;

    const vivos = lista.filter(g => g.estado !== "cancelado");
    const publicados = vivos.filter(g => g.estado === "publicado").length;

    const estado = vivos.length === 0 ? "cancelado"
        : publicados === vivos.length ? "publicado"
            : publicados > 0 ? "publicado_parcial"
                : "fallido";

    await repo.actualizarSorteoSi(usuarioId, sorteoId, { estados: ["publicando"] }, { estado });

}

async function publicarPendientes({ sock, deps, ahora }) {

    const usuarioId = sock.context.usuarioId;
    const pendientes = await repo.sorteosParaPublicar(usuarioId, ahora);
    if (!pendientes.ok) return { ok: false, motivo: pendientes.motivo };

    const autorizadosRes = await repo.gruposAutorizados(usuarioId);
    const autorizados = new Set((autorizadosRes.data || []).map(g => g.grupo_id));

    const informe = [];

    for (let sorteo of pendientes.data) {

        // Nunca una versión sin confirmar (p. ej. editada después de confirmar).
        if (sorteo.confirmado_version !== sorteo.version) continue;

        if (sorteo.estado === "programado") {
            const tomado = await repo.actualizarSorteoSi(usuarioId, sorteo.id, { version: sorteo.version, estados: ["programado"] }, { estado: "publicando" });
            if (!tomado.ok) continue;
            sorteo = tomado.data;
        }

        const grupos = await repo.gruposDelSorteo(usuarioId, sorteo.id);
        if (!grupos.ok) continue;

        for (const grupo of grupos.data) {

            if (!["pendiente", "fallido"].includes(grupo.estado)) continue;
            if ((Number(grupo.intentos) || 0) >= MAX_INTENTOS_AUTOMATICOS) continue;
            if (!deps.puedeActuar(sock)) break;

            const reclamado = await repo.reclamarGrupo(usuarioId, grupo.id, grupo.intentos);
            if (!reclamado.ok) continue;

            let cambios;

            try {
                cambios = await publicarEnGrupo({ sock, sorteo, grupo: reclamado.data, autorizados, deps, ahora });
            } catch (err) {
                cambios = { estado: "fallido", ultimo_error: `Error inesperado antes de enviar: ${err?.message}` };
            }

            // Tras agotar los reintentos automáticos, revisión manual.
            if (cambios.estado === "fallido" && (Number(reclamado.data.intentos) || 0) >= MAX_INTENTOS_AUTOMATICOS) {
                cambios.estado = "requiere_revision";
            }

            await repo.marcarGrupo(usuarioId, grupo.id, cambios);
            informe.push({ sorteo: sorteo.id, grupo: grupo.grupo_id, estado: cambios.estado, error: cambios.ultimo_error || null });

        }

        await finalizarSorteo(usuarioId, sorteo.id);

    }

    return { ok: true, informe };

}

// ------------------------------------------- recordatorios y aviso final ---

async function enviarUnaVez({ deps, sock, sorteo, grupoId, sufijo, tipoAccion, texto }) {
    return deps.ejecutarUnaVez({
        claveIdempotencia: `sorteo:${sorteo.id}:grupo:${grupoId}:${sufijo}`,
        grupoId,
        usuarioId: sorteo.usuario_id,
        tipoAccion,
        ejecutar: () => deps.sendMessage({ sock, jid: grupoId, text: texto })
    });
}

async function procesarPublicados({ sock, deps, ahora }) {

    const usuarioId = sock.context.usuarioId;
    const res = await repo.sorteosPublicados(usuarioId);
    if (!res.ok) return { ok: false };

    const envios = [];

    for (const sorteo of res.data) {

        const grupos = await repo.gruposDelSorteo(usuarioId, sorteo.id);
        const publicados = (grupos.data || []).filter(g => g.estado === "publicado" && g.evento_bot_id);
        if (!publicados.length) continue;

        // Fila completa: el estado real de los números (antes de cada
        // recordatorio) necesita tabla, cifras y cantidad del sorteo.
        const { data: eventos } = await deps.supabase.from("eventos_bot")
            .select("*").in("id", publicados.map(g => g.evento_bot_id));

        const fecha = partesBogota(new Date(sorteo.publicar_en)).fecha;
        const cierre = instanteBogota(fecha, sorteo.config.hora_cierre);

        for (const g of publicados) {

            const ev = (eventos || []).find(e => e.id === g.evento_bot_id);

            // La fila de eventos_bot ya es de OTRO sorteo (el grupo pasó a
            // otro): nada más que enviar para éste.
            if (!ev || ev.identidad_evento_real !== sorteo.identidad_evento_real) continue;

            if (ev.activo) {

                // Estado real del sorteo, leído solo si algún recordatorio
                // está dentro de su ventana (una vez por grupo y ciclo).
                let decision = null;

                for (const rec of sorteo.config.recordatorios || []) {

                    const momento = cierre ? cierre.getTime() - rec.minutos_antes_cierre * 60 * 1000 : null;

                    // Solo dentro de su ventana: un recordatorio atrasado (bot
                    // caído) no se envía tarde.
                    if (!momento || ahora.getTime() < momento || ahora.getTime() >= momento + VENTANA_RECORDATORIO_MS || ahora.getTime() >= cierre.getTime()) continue;
                    if (!deps.puedeActuar(sock)) return { ok: true, envios };

                    if (!decision) {
                        const leerEstado = deps.leerEstadoParaRecordatorios || leerEstadoParaRecordatorios;
                        decision = decidirRecordatoriosSegunEstado(await leerEstado(ev, g.grupo_id));
                    }

                    // El texto del recordatorio programado es libre (no indica
                    // si invita a participar o recuerda pagar): se omite solo
                    // cuando no corresponde NINGUNO de los dos — todo pagado,
                    // o sin libres ni pendientes, o grupo cerrado sin
                    // pendientes. Si no se pudo leer el estado, se reintenta
                    // dentro de la misma ventana.
                    if (!decision.participacion && !decision.cobro) {
                        envios.push({ tipo: "recordatorio", grupo: g.grupo_id, ejecutada: false, motivo: decision.reintentar ? "estado_no_disponible" : `omitido_${decision.motivo}` });
                        continue;
                    }

                    const { texto } = mensajeRecordatorio(sorteo.config, rec, sorteo.cuentas_snapshot, { fecha });
                    const r = await enviarUnaVez({ deps, sock, sorteo, grupoId: g.grupo_id, sufijo: `recordatorio:${rec.minutos_antes_cierre}`, tipoAccion: "SORTEO_RECORDATORIO", texto });
                    envios.push({ tipo: "recordatorio", grupo: g.grupo_id, ejecutada: r.ejecutada, motivo: r.motivo || null });

                }

            } else if (ev.estado === "cerrado" && sorteo.config.mensajes?.aviso_cierre) {

                if (!deps.puedeActuar(sock)) return { ok: true, envios };

                const { texto } = mensajeAvisoCierre(sorteo.config, sorteo.cuentas_snapshot, { fecha });
                const r = await enviarUnaVez({ deps, sock, sorteo, grupoId: g.grupo_id, sufijo: "aviso_cierre", tipoAccion: "SORTEO_AVISO_CIERRE", texto });
                envios.push({ tipo: "aviso_cierre", grupo: g.grupo_id, ejecutada: r.ejecutada, motivo: r.motivo || null });

            }

        }

    }

    return { ok: true, envios };

}

// -------------------------------------------- vencimiento de reservas ---

// Solo para sorteos que lo activaron EXPLÍCITAMENTE (desactivado por
// defecto). Libera 'reservado' -> 'libre' con UPDATE condicionado al estado:
// un número que se pagó entretanto nunca se libera.
async function liberarVencidas({ sock, deps, ahora }) {

    const usuarioId = sock.context.usuarioId;
    const res = await repo.sorteosPublicados(usuarioId);
    if (!res.ok) return { ok: false };

    const liberados = [];

    for (const sorteo of res.data) {

        const reservas = sorteo.config.reservas || {};
        if (reservas.liberar_no_pagados !== true || !(reservas.vencimiento_minutos > 0)) continue;

        // Solo mientras el sorteo siga activo en algún grupo.
        const { data: activos } = await deps.supabase.from("eventos_bot").select("*")
            .eq("usuario_id", usuarioId).eq("identidad_evento_real", sorteo.identidad_evento_real).eq("activo", true);
        if (!activos?.length) continue;

        const { data: filas, error } = await deps.supabase.from(sorteo.tabla)
            .select("numero, estado, fecha_reserva, hora_reserva, comprador, contacto")
            .eq("usuario_id", usuarioId).eq("identidad_evento_real", sorteo.identidad_evento_real).eq("estado", "reservado");
        if (error) continue;

        let liberadosSorteo = 0;

        for (const fila of filas || []) {

            const reservadoEn = instanteBogota(fila.fecha_reserva, fila.hora_reserva);

            // Sin fecha de reserva no se puede saber si venció: no se toca.
            if (!reservadoEn || ahora.getTime() - reservadoEn.getTime() < reservas.vencimiento_minutos * 60 * 1000) continue;

            const { data: cambiadas } = await deps.supabase.from(sorteo.tabla)
                .update(CAMPOS_LIBERACION)
                .eq("usuario_id", usuarioId).eq("numero", fila.numero)
                .eq("identidad_evento_real", sorteo.identidad_evento_real).eq("estado", "reservado")
                .select("numero");

            if (!cambiadas?.length) continue;

            liberadosSorteo++;
            liberados.push({ sorteo: sorteo.id, numero: fila.numero });

            await deps.supabase.from("reservas_actividad").insert({
                usuario_id: usuarioId,
                tabla: sorteo.tabla,
                numero: fila.numero,
                evento_id: activos[0].id,
                tipo: "liberado",
                detalle: { motivo: "vencimiento", minutos: reservas.vencimiento_minutos, comprador: fila.comprador || null, contacto: fila.contacto || null },
                realizado_por: "bot:vencimiento"
            });

        }

        if (liberadosSorteo) await deps.actualizarEvento(activos[0]);

    }

    return { ok: true, liberados };

}

// ----------------------------------------------------------------- tick ---

async function tick(sock, { ahora = new Date(), deps = null } = {}) {

    if (!sock?.context?.usuarioId) return { ok: false, motivo: "sin_tenant" };

    const d = deps || dependenciasReales();

    const publicacion = await publicarPendientes({ sock, deps: d, ahora });
    const mensajes = await procesarPublicados({ sock, deps: d, ahora });
    const vencimientos = await liberarVencidas({ sock, deps: d, ahora });

    return { ok: true, publicacion, mensajes, vencimientos };

}

// --------------------------------------------------------------- worker ---

const intervalos = new Map();
const ejecutando = new Set();

function iniciarPublicadorSorteos(sock, { intervaloMs = 30000 } = {}) {

    const sessionId = sock?.context?.sessionId;
    if (!sessionId) return false;

    detenerPublicadorSorteos(sessionId);

    const propiedadSesion = require("../services/baileys/propiedadSesion");

    const intervalo = setInterval(async () => {

        if (ejecutando.has(sessionId) || !propiedadSesion.puedeActuar(sock)) return;

        ejecutando.add(sessionId);

        try {
            const r = await tick(sock);
            if (r.publicacion?.motivo === "migracion_pendiente") {
                // Sin la migración 024 no hay sorteos programados: silencio.
            }
        } catch (err) {
            console.error(`❌ [SORTEOS PROGRAMADOS] error en el ciclo (${sessionId}):`, err?.message);
        } finally {
            ejecutando.delete(sessionId);
        }

    }, intervaloMs);

    if (typeof intervalo.unref === "function") intervalo.unref();

    intervalos.set(sessionId, intervalo);

    return true;

}

function detenerPublicadorSorteos(sessionId) {

    if (!intervalos.has(sessionId)) return false;

    clearInterval(intervalos.get(sessionId));
    intervalos.delete(sessionId);

    return true;

}

module.exports = {
    tick,
    publicarPendientes,
    procesarPublicados,
    liberarVencidas,
    iniciarPublicadorSorteos,
    detenerPublicadorSorteos,
    instanteBogota,
    MAX_INTENTOS_AUTOMATICOS
};
