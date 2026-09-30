// ==========================================================================
// DIAGNÓSTICO DEL CICLO DE VIDA DE MENSAJES Y SESIONES (Paso 0)
// ==========================================================================
// Objetivo: DEMOSTRAR con datos reales en qué punto un mensaje antiguo
// (offline / recuperado / reenviado / duplicado / de otra sesión) termina
// convertido en una acción nueva del bot, y si un socket que ya no es el
// activo (o que ya está cerrado) sigue ejecutando acciones.
//
// SOLO OBSERVA. Con DEBUG_MESSAGE_LIFECYCLE distinto de "true" todas las
// funciones de este archivo retornan de inmediato sin hacer nada (y
// ejecutarConTraza simplemente llama a fn()). Aun activado:
//   - nunca modifica un mensaje, un socket ni un resultado;
//   - nunca filtra, retrasa ni descarta nada;
//   - nunca consulta Supabase;
//   - cualquier error interno se traga aquí (try/catch), jamás se propaga
//     al flujo real.
//
// El "PROCESSING_REASON" que se imprime es la clasificación que APLICARÍA
// la futura compuerta de ingreso (Fase 3) — hoy es solo informativo: el
// mensaje sigue el flujo real exactamente igual que antes.
//
// Qué registra:
//   1. SOCKET: creación (epoch incremental por instancia), open,
//      receivedPendingNotifications (flush del backlog offline), close.
//   2. INGRESO: cada mensaje de messages.upsert, visto por un observador
//      registrado al CREAR el socket (antes que cualquier listener de
//      negocio) — así también se ven los mensajes que llegan cuando el
//      listener de negocio todavía no existe o ya se quitó.
//   3. ETAPAS: listener de negocio -> dispatcher -> detectores, enlazadas
//      por AsyncLocalStorage (mismo traceId = key.id del mensaje).
//   4. ACCIONES: abrir/cerrar grupo, expulsar, enviar mensaje/imagen —
//      con su ORIGEN (qué mensaje las causó, o "sin mensaje": worker,
//      scheduler, listener de grupos) y el estado del socket que las
//      ejecuta. Las acciones sospechosas se marcan con ALERTA.
//   5. WORKERS: ticks de workerEventos/scheduler SOLO cuando corren sobre
//      un socket que no es el activo o que no está abierto (anomalía).
//
// Salida: bloques "[CICLO] ..." por consola (pm2 logs) y, opcionalmente,
// una línea JSON por registro en DEBUG_MESSAGE_LIFECYCLE_FILE.
// ==========================================================================

const fs = require("fs");
const path = require("path");
const { AsyncLocalStorage } = require("async_hooks");

const { enmascararJid } = require("../bot/utils/enmascararJid");

// Tolerancia de reloj servidor <-> WhatsApp para considerar un mensaje
// "anterior a la conexión" (solo afecta a la etiqueta del diagnóstico).
const TOLERANCIA_RELOJ_MS = 30 * 1000;

const MAX_IDS_VISTOS = 20000;
const MAX_VEREDICTOS = 5000;

function activo() {
    return process.env.DEBUG_MESSAGE_LIFECYCLE === "true";
}

const als = new AsyncLocalStorage();

// sock -> metadatos de ESA instancia de socket (no de la sesión: una
// misma sesión que reconecta produce un socket nuevo con epoch nuevo).
const metasPorSocket = new WeakMap();
let contadorEpoch = 0;

// key.id -> { veces, primeraVezMs, sesiones: Set("sessionId#epoch") }
const idsVistos = new Map();

// "sessionId#epoch|key.id" -> veredicto calculado al ingresar, para que la
// etapa del listener de negocio lo recupere sin recalcular (y sin contar
// dos veces el mismo ingreso como duplicado).
const veredictos = new Map();

// ---------------------------------------------------------------- util ---

function silencioso(fn) {
    try {
        return fn();
    } catch (err) {
        try {
            console.error("⚠️ [CICLO] error interno del diagnóstico (ignorado):", err?.message);
        } catch (_) { /* nada */ }
        return undefined;
    }
}

function iso(ms) {
    return ms ? new Date(ms).toISOString() : null;
}

function formatearEdad(ms) {

    if (ms === null || ms === undefined || Number.isNaN(ms)) return null;

    const signo = ms < 0 ? "-" : "";
    let s = Math.floor(Math.abs(ms) / 1000);

    const d = Math.floor(s / 86400); s -= d * 86400;
    const h = Math.floor(s / 3600); s -= h * 3600;
    const m = Math.floor(s / 60); s -= m * 60;

    const partes = [];
    if (d) partes.push(`${d}d`);
    if (h) partes.push(`${h}h`);
    if (m) partes.push(`${m}m`);
    partes.push(`${s}s`);

    return signo + partes.join(" ");

}

// messageTimestamp viene en segundos (number, string o Long de protobuf).
function timestampMs(message) {

    const t = message?.messageTimestamp;

    if (t === null || t === undefined) return null;

    const n = typeof t?.toNumber === "function" ? t.toNumber() : Number(t);

    return Number.isFinite(n) && n > 0 ? n * 1000 : null;

}

// Los JID de grupo no son datos personales; los de personas se enmascaran
// con el criterio único del sistema.
function jidParaLog(jid) {
    if (!jid) return null;
    return jid.endsWith("@g.us") ? jid : enmascararJid(jid);
}

function managerSeguro() {
    // require perezoso: manager.js -> socket.js -> este archivo; un require
    // arriba del todo formaría un ciclo y devolvería un objeto vacío.
    try {
        return require("../services/baileys/manager");
    } catch (_) {
        return null;
    }
}

function estadoSocket(sock) {

    const meta = sock ? metasPorSocket.get(sock) : null;
    const manager = managerSeguro();
    const socketActivo = manager?.getActiveSocket?.() || null;

    return {
        sessionId: sock?.context?.sessionId ?? meta?.sessionId ?? null,
        epoch: meta?.epoch ?? null,
        estado: meta?.estado ?? "desconocido",
        esSocketActivo: !!sock && sock === socketActivo,
        sesionActiva: manager?.getActiveSession?.() ?? null,
        epochActivo: socketActivo ? (metasPorSocket.get(socketActivo)?.epoch ?? null) : null
    };

}

function emitir(titulo, campos) {

    const lineas = [`[CICLO] ───── ${titulo} ─────`];

    for (const [k, v] of Object.entries(campos)) {
        if (v === undefined) continue;
        lineas.push(`[CICLO] ${k}: ${typeof v === "object" && v !== null ? JSON.stringify(v) : v}`);
    }

    console.log(lineas.join("\n"));

    const archivo = process.env.DEBUG_MESSAGE_LIFECYCLE_FILE;

    if (archivo) {

        const linea = JSON.stringify({ ts: new Date().toISOString(), tipo: titulo, ...campos }) + "\n";

        fs.promises.mkdir(path.dirname(path.resolve(archivo)), { recursive: true })
            .then(() => fs.promises.appendFile(archivo, linea))
            .catch(() => { /* el diagnóstico nunca debe romper nada */ });

    }

}

function recortarMapa(mapa, maximo) {
    while (mapa.size > maximo) {
        mapa.delete(mapa.keys().next().value);
    }
}

// ------------------------------------------------------------ socket ---

// Se llama UNA vez, justo después de makeWASocket (socket.js), antes de
// registrar cualquier otro listener. Los listeners que agrega aquí son
// solo de lectura y existen únicamente con el diagnóstico activado.
// connection.update NO se escucha aquí (un socket debe tener un único
// listener de ese evento, el de estados.js — ver socketLockReconexion
// test): estados.js llama a observarConexion() como primera línea.
function observarSocket(sock, sessionId) {

    if (!activo()) return;

    silencioso(() => {

        if (!sock?.ev) return;

        const meta = {
            sessionId,
            epoch: ++contadorEpoch,
            creadoEn: Date.now(),
            estado: "connecting",
            connectedAt: null,
            pendingFlushedAt: null,
            cerradoEn: null,
            listenerNegocio: false,
            mensajesAntesDeOpen: 0,
            mensajesAppend: 0,
            mensajesNotify: 0
        };

        metasPorSocket.set(sock, meta);

        emitir("SOCKET_CREADO", {
            SESSION_ID: sessionId,
            SOCKET_EPOCH: meta.epoch,
            CREADO_EN: iso(meta.creadoEn)
        });

        sock.ev.on("messages.upsert", (evento) => silencioso(() => {

            const { messages, type, requestId } = evento || {};

            for (const message of messages || []) {
                registrarIngreso(sock, message, type, requestId);
            }

        }));

        sock.ev.on("group-participants.update", (data) => silencioso(() => {

            emitir("EVENTO_GRUPO", {
                EVENT: "group-participants.update",
                ACCION_GRUPO: data?.action ?? null,
                REMOTE_JID: jidParaLog(data?.id),
                PARTICIPANTES: (data?.participants || []).length,
                ...estadoSocketResumen(sock),
                ALERTA: estadoSocket(sock).esSocketActivo
                    ? undefined
                    : "evento de grupo recibido por un socket que NO es el activo — groups.js igual reacciona (sincronizar/escanear/bloqueo)"
            });

        }));

    });

}

// Primera línea del listener de connection.update de estados.js — ANTES
// de su guardia de socket obsoleto, para ver también los eventos tardíos
// de sockets reemplazados.
function observarConexion(sock, update) {

    if (!activo()) return;

    silencioso(() => {

        const meta = metasPorSocket.get(sock);

        if (!meta || !update) return;

        const sessionId = meta.sessionId;
        const ahora = Date.now();

        if (update.connection === "open") {

            meta.estado = "open";
            meta.connectedAt = ahora;

            emitir("SOCKET_OPEN", {
                SESSION_ID: sessionId,
                SOCKET_EPOCH: meta.epoch,
                SESSION_CONNECTED_AT: iso(ahora),
                LISTENER_NEGOCIO_YA_REGISTRADO: meta.listenerNegocio,
                ...estadoSocketResumen(sock)
            });

        }

        if (update.receivedPendingNotifications === true) {

            meta.pendingFlushedAt = ahora;

            emitir("SOCKET_BACKLOG_OFFLINE_ENTREGADO", {
                SESSION_ID: sessionId,
                SOCKET_EPOCH: meta.epoch,
                PENDING_FLUSHED_AT: iso(ahora),
                MS_DESDE_OPEN: meta.connectedAt ? ahora - meta.connectedAt : null,
                LISTENER_NEGOCIO_REGISTRADO: meta.listenerNegocio,
                MENSAJES_APPEND_HASTA_AHORA: meta.mensajesAppend,
                MENSAJES_NOTIFY_HASTA_AHORA: meta.mensajesNotify
            });

        }

        if (update.connection === "close") {

            meta.estado = "closed";
            meta.cerradoEn = ahora;

            emitir("SOCKET_CLOSE", {
                SESSION_ID: sessionId,
                SOCKET_EPOCH: meta.epoch,
                CERRADO_EN: iso(ahora),
                STATUS_CODE: update.lastDisconnect?.error?.output?.statusCode ?? null,
                LISTENER_NEGOCIO_SIGUE_REGISTRADO: meta.listenerNegocio,
                ...estadoSocketResumen(sock)
            });

        }

    });

}

function estadoSocketResumen(sock) {

    const e = estadoSocket(sock);

    return {
        SOCKET_SESSION_ID: e.sessionId,
        SOCKET_EPOCH: e.epoch,
        SOCKET_ESTADO: e.estado,
        ES_SOCKET_ACTIVO: e.esSocketActivo,
        SESION_ACTIVA_MANAGER: e.sesionActiva,
        EPOCH_SOCKET_ACTIVO: e.epochActivo
    };

}

// Lo llaman registerMessages/unregisterMessages para saber si, en el
// momento en que llegó cada mensaje, había un listener de negocio en
// ESE socket (si no lo había, el mensaje se pierde para el negocio).
function marcarListenerNegocio(sock, registrado) {

    if (!activo() || !sock) return;

    silencioso(() => {

        const meta = metasPorSocket.get(sock);

        if (meta) meta.listenerNegocio = !!registrado;

        emitir(registrado ? "LISTENER_NEGOCIO_REGISTRADO" : "LISTENER_NEGOCIO_ELIMINADO", {
            ...estadoSocketResumen(sock),
            SOCKET_OPEN_EN: iso(meta?.connectedAt),
            BACKLOG_OFFLINE_YA_ENTREGADO: !!meta?.pendingFlushedAt,
            ALERTA: registrado && meta && meta.estado !== "open"
                ? "listener de negocio registrado ANTES de que el socket esté open — recibirá el backlog offline completo"
                : undefined
        });

    });

}

// ----------------------------------------------------------- ingreso ---

// Clasificación PURA (exportada para pruebas). No tiene efectos.
function clasificarIngreso({ message, type, requestId, meta, esSocketActivo, vecesVisto, ahora = Date.now() }) {

    const tsMs = timestampMs(message);
    const fromMe = !!message?.key?.fromMe;

    if (!esSocketActivo) return "OTRA_SESION_O_SOCKET_NO_ACTIVO";
    if (meta && meta.estado !== "open") return "SOCKET_NO_OPEN";
    if (vecesVisto > 1) return "DUPLICADO";
    if (requestId) return "REENVIO_PLACEHOLDER";
    if (type && type !== "notify") return fromMe ? "APPEND_ECO_PROPIO_U_OFFLINE" : "RECUPERADO_OFFLINE";
    if (meta?.connectedAt && tsMs && tsMs < meta.connectedAt - TOLERANCIA_RELOJ_MS) return "HISTORICO_ANTERIOR_A_CONEXION";
    if (tsMs && ahora - tsMs > 10 * 60 * 1000) return "NOTIFY_PERO_ANTIGUO";

    return "NUEVO";

}

function registrarIngreso(sock, message, type, requestId) {

    const meta = metasPorSocket.get(sock) || null;
    const id = message?.key?.id || null;
    const ahora = Date.now();
    const est = estadoSocket(sock);

    if (meta) {
        if (meta.estado !== "open") meta.mensajesAntesDeOpen++;
        if (type === "notify") meta.mensajesNotify++;
        else meta.mensajesAppend++;
    }

    // Duplicados: el mismo key.id visto más de una vez en este proceso
    // (por cualquier socket/sesión).
    let registro = null;

    if (id) {

        registro = idsVistos.get(id);

        if (!registro) {
            registro = { veces: 0, primeraVezMs: ahora, sesiones: new Set() };
            idsVistos.set(id, registro);
            recortarMapa(idsVistos, MAX_IDS_VISTOS);
        }

        registro.veces++;
        registro.sesiones.add(`${est.sessionId}#${est.epoch}`);

    }

    const tsMs = timestampMs(message);

    const razon = clasificarIngreso({
        message,
        type,
        requestId,
        meta,
        esSocketActivo: est.esSocketActivo,
        vecesVisto: registro?.veces || 1,
        ahora
    });

    const veredicto = {
        razon,
        tsMs,
        edadMs: tsMs ? ahora - tsMs : null,
        type: type ?? null,
        sessionId: est.sessionId,
        epoch: est.epoch
    };

    if (id) {
        veredictos.set(`${est.sessionId}#${est.epoch}|${id}`, veredicto);
        recortarMapa(veredictos, MAX_VEREDICTOS);
    }

    emitir(`INGRESO ${id || "(sin id)"}`, {
        MESSAGE_ID: id,
        REMOTE_JID: jidParaLog(message?.key?.remoteJid),
        PARTICIPANT: message?.key?.participant ? enmascararJid(message.key.participant) : null,
        FROM_ME: !!message?.key?.fromMe,
        TIENE_CONTENIDO: !!message?.message,
        EVENT_TYPE: type ?? null,
        REQUEST_ID: requestId ?? null,
        MESSAGE_TIMESTAMP: iso(tsMs),
        SESSION_CONNECTED_AT: iso(meta?.connectedAt),
        RECIBIDO_EN: iso(ahora),
        MESSAGE_AGE: formatearEdad(veredicto.edadMs),
        ANTES_DE_FLUSH_OFFLINE: meta ? !meta.pendingFlushedAt : null,
        VECES_VISTO: registro?.veces ?? null,
        VISTO_EN_SOCKETS: registro ? [...registro.sesiones] : null,
        ...estadoSocketResumen(sock),
        LISTENER_NEGOCIO_EN_ESTE_SOCKET: meta?.listenerNegocio ?? null,
        PROCESSING_REASON: razon,
        DESTINO_REAL_HOY: meta?.listenerNegocio
            ? "pasa por la compuerta de ingreso (compuertaIngreso.js) antes del negocio"
            : "NO hay listener de negocio en este socket — el negocio no lo ve"
    });

}

// ------------------------------------------------------------ etapas ---

// Envuelve el procesamiento de UN mensaje en el listener de negocio para
// que todo lo que ocurra dentro (dispatcher, detectores, acciones, incluso
// promesas fire-and-forget) quede enlazado a ese mensaje.
function ejecutarConTraza({ sock, message, listener }, fn) {

    if (!activo()) return fn();

    const store = silencioso(() => {

        const est = estadoSocket(sock);
        const id = message?.key?.id || null;
        const v = veredictos.get(`${est.sessionId}#${est.epoch}|${id}`) || null;

        const s = {
            traceId: id,
            remoteJid: message?.key?.remoteJid || null,
            razon: v?.razon ?? "SIN_VEREDICTO (socket no observado)",
            edadMs: v?.edadMs ?? null,
            type: v?.type ?? null,
            sessionId: est.sessionId,
            epoch: est.epoch
        };

        emitir(`ETAPA listener ${id}`, {
            MESSAGE_ID: id,
            LISTENER: listener,
            PROCESSING_REASON: s.razon,
            MESSAGE_AGE: formatearEdad(s.edadMs),
            ...estadoSocketResumen(sock)
        });

        return s;

    });

    return store ? als.run(store, fn) : fn();

}

function etapa(nombre, datos = {}) {

    if (!activo()) return;

    silencioso(() => {

        const s = als.getStore();

        if (!s) return;

        emitir(`ETAPA ${nombre} ${s.traceId}`, {
            MESSAGE_ID: s.traceId,
            ETAPA: nombre,
            PROCESSING_REASON: s.razon,
            MESSAGE_AGE: formatearEdad(s.edadMs),
            ...datos
        });

    });

}

// ----------------------------------------------------------- acciones ---

function origenActual() {

    const s = als.getStore();

    if (!s) return { ORIGEN: "SIN_MENSAJE (worker / scheduler / listener de grupos / panel)" };

    return {
        ORIGEN: "MENSAJE",
        ORIGEN_MESSAGE_ID: s.traceId,
        ORIGEN_REMOTE_JID: jidParaLog(s.remoteJid),
        ORIGEN_PROCESSING_REASON: s.razon,
        ORIGEN_MESSAGE_AGE: formatearEdad(s.edadMs),
        ORIGEN_EVENT_TYPE: s.type,
        ORIGEN_SESSION: `${s.sessionId}#${s.epoch}`
    };

}

function alertasAccion(origen, e) {

    const alertas = [];

    if (origen.ORIGEN === "MENSAJE" && origen.ORIGEN_PROCESSING_REASON !== "NUEVO") {
        alertas.push(`acción causada por un mensaje clasificado como ${origen.ORIGEN_PROCESSING_REASON}`);
    }

    if (!e.esSocketActivo) alertas.push("el socket que ejecuta la acción NO es el socket activo");
    if (e.estado !== "open") alertas.push(`el socket que ejecuta la acción está en estado "${e.estado}"`);

    return alertas.length ? alertas.join(" | ") : undefined;

}

// Se llama en el momento en que el código PIDE la acción. Devuelve una
// "ficha" que se vuelve a pasar a accionEjecutada() si la acción se
// ejecuta más tarde (p. ej. cola de IQ de grupo), para ver si en ese
// momento el socket sigue siendo válido.
function accion(tipo, sock, destino) {

    if (!activo()) return null;

    return silencioso(() => {

        const origen = origenActual();
        const e = estadoSocket(sock);

        emitir(`ACCION ${tipo}`, {
            ACCION: tipo,
            DESTINO: jidParaLog(destino),
            ...origen,
            ...estadoSocketResumen(sock),
            ALERTA: alertasAccion(origen, e)
        });

        return { tipo, destino, origen, pedidoEn: Date.now() };

    }) || null;

}

function accionEjecutada(ficha, sock) {

    if (!activo() || !ficha) return;

    silencioso(() => {

        const e = estadoSocket(sock);
        const alerta = alertasAccion({ ORIGEN: "cola" }, e);

        // Solo se reporta si algo cambió mal mientras esperaba en la cola.
        if (!alerta) return;

        emitir(`ACCION_EJECUTADA_DESDE_COLA ${ficha.tipo}`, {
            ACCION: ficha.tipo,
            DESTINO: jidParaLog(ficha.destino),
            ESPERO_EN_COLA_MS: Date.now() - ficha.pedidoEn,
            ...ficha.origen,
            ...estadoSocketResumen(sock),
            ALERTA: alerta
        });

    });

}

// ------------------------------------------------------------ workers ---

function tickWorker(nombre, sock) {

    if (!activo()) return;

    silencioso(() => {

        const e = estadoSocket(sock);

        if (e.esSocketActivo && e.estado === "open") return;

        emitir(`WORKER_TICK_ANOMALO ${nombre}`, {
            WORKER: nombre,
            ...estadoSocketResumen(sock),
            ALERTA: `worker corriendo sobre un socket ${e.esSocketActivo ? "" : "NO activo "}en estado "${e.estado}"`
        });

    });

}

// Solo para pruebas.
function _reiniciar() {
    idsVistos.clear();
    veredictos.clear();
    contadorEpoch = 0;
}

module.exports = {
    activo,
    observarSocket,
    observarConexion,
    marcarListenerNegocio,
    clasificarIngreso,
    ejecutarConTraza,
    etapa,
    accion,
    accionEjecutada,
    tickWorker,
    formatearEdad,
    _metaDe: (sock) => metasPorSocket.get(sock) || null,
    _reiniciar
};
