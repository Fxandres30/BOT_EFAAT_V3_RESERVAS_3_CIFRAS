// ==========================================================================
// COMPUERTA DE INGRESO DE MENSAJES — única decisión ANTES del negocio.
// ==========================================================================
// Problema que cierra: al reconectar, reiniciar o cambiar de sesión,
// WhatsApp/Baileys vuelve a entregar mensajes que ya pasaron (backlog
// offline como type "append", reintentos con el mismo key.id, reenvíos de
// placeholder como "notify" con timestamp viejo). Sin esta compuerta
// entraban otra vez a dispatcher -> reservas/eventos/abrir grupo/pagos.
//
//   mensaje recibido
//     -> identidad estable (remoteJid + key.id)
//     -> ¿ya visto/procesado?      SÍ -> DESCARTAR (ni historial ni negocio)
//     -> ¿histórico/recuperado?    SÍ -> SOLO HISTORIAL (sin acciones)
//     -> procesamiento normal (flujo existente, sin cambios)
//
// IDENTIDAD: (key.remoteJid, key.id). Es la clave que usa WhatsApp/Baileys
// para un mensaje dentro de un chat y es la MISMA para todas las sesiones
// que lo reciben (el id lo asigna el remitente). NO forman parte de la
// identidad, a propósito (verificado con datos reales de
// mensajes_grupos_sorteos, 2026-09-30):
//   - messageTimestamp: un reintento del MISMO mensaje llega con un "t"
//     unos segundos distinto (p. ej. la reserva "71" registrada dos veces
//     con 4 s de diferencia);
//   - key.participant: el MISMO mensaje llega a veces como @lid y a veces
//     como @s.whatsapp.net según la sesión/entrega.
// En grupos, remoteJid === grupo_id de mensajes_grupos_sorteos.
//
// PERSISTENCIA ("ya procesado"): la fila de mensajes_grupos_sorteos que
// guardarMensajeGrupo inserta ANTES de cualquier acción de negocio. Si ya
// existe una fila con (grupo_id, mensaje_id), ese mensaje ya pasó por el
// bot (en esta u otra sesión, antes o después de un reinicio) -> se
// descarta. Con la migración 021 aplicada, el índice único convierte la
// inserción en un "reclamo" atómico (23505 = otro lo reclamó primero).
// La memoria (en vuelo + recientes) es solo una optimización y la
// protección para lo que no llega a persistirse.
//
// HISTÓRICO: un mensaje que ya existía antes de que ESTA sesión empezara
// a procesar (registro del listener de negocio sobre este socket) no
// genera acciones: se registra para historial y se corta ahí.
// ==========================================================================

const supabase = require("../../../lib/supabase");

// Margen para diferencias de reloj servidor <-> WhatsApp al comparar el
// timestamp del mensaje con el inicio de procesamiento de la sesión.
const TOLERANCIA_RELOJ_MS = 30 * 1000;

const MAX_RECIENTES = 5000;

const MOTIVOS = {
    NUEVO: "NUEVO",
    OFFLINE: "RECUPERADO_OFFLINE",            // type !== "notify" (append)
    REENVIO: "REENVIO_PLACEHOLDER",           // trae requestId
    ANTERIOR: "ANTERIOR_AL_INICIO_DE_SESION"  // notify con timestamp previo
};

// clave -> true mientras se procesa (dos entregas casi simultáneas del
// mismo mensaje: la segunda se descarta sin esperar a la BD).
const enVuelo = new Set();

// clave -> true para mensajes ya decididos por este proceso (acotado).
const recientes = new Map();

// MULTICLIENTE (2026-10-21): el mismo mensaje de un grupo compartido llega a
// la sesión de CADA cliente que está en el grupo, y cada cliente lo procesa
// por su cuenta. La clave incluye al cliente dueño de la sesión receptora
// (sock.context.usuarioId, nunca el participante): dentro de un cliente se
// sigue descartando el duplicado; entre clientes, no.
function identidadMensaje(message, clienteUsuarioId = null) {

    const remoteJid = message?.key?.remoteJid || null;
    const mensajeId = message?.key?.id || null;

    if (!remoteJid || !mensajeId) return null;

    return {
        clave: `${clienteUsuarioId || "-"}|${remoteJid}|${mensajeId}`,
        remoteJid,
        mensajeId,
        clienteUsuarioId,
        esGrupo: remoteJid.endsWith("@g.us")
    };

}

// messageTimestamp: segundos (number, string o Long de protobuf).
function timestampMs(message) {

    const t = message?.messageTimestamp;

    if (t === null || t === undefined) return null;

    const n = typeof t?.toNumber === "function" ? t.toNumber() : Number(t);

    return Number.isFinite(n) && n > 0 ? n * 1000 : null;

}

// Decisión PURA: ¿el mensaje es presente o pasado para ESTA sesión?
// inicioProcesamientoMs = momento en que el listener de negocio empezó a
// escuchar este socket (messages.upsert.js), es decir, el inicio real de
// la sesión para el negocio.
function clasificarIngreso({ message, type, requestId, inicioProcesamientoMs }) {

    if (type && type !== "notify") {
        return { historico: true, motivo: MOTIVOS.OFFLINE };
    }

    if (requestId) {
        return { historico: true, motivo: MOTIVOS.REENVIO };
    }

    const tsMs = timestampMs(message);

    if (tsMs && inicioProcesamientoMs && tsMs < inicioProcesamientoMs - TOLERANCIA_RELOJ_MS) {
        return { historico: true, motivo: MOTIVOS.ANTERIOR };
    }

    return { historico: false, motivo: MOTIVOS.NUEVO };

}

// ---------------------------------------------------------------- memoria --

// true si se tomó el mensaje; false si ya está en vuelo o ya fue decidido
// por este proceso (duplicado en memoria).
function tomarEnMemoria(clave) {

    if (enVuelo.has(clave) || recientes.has(clave)) return false;

    enVuelo.add(clave);

    return true;

}

function liberarEnMemoria(clave) {

    enVuelo.delete(clave);

    recientes.set(clave, true);

    while (recientes.size > MAX_RECIENTES) {
        recientes.delete(recientes.keys().next().value);
    }

}

// ------------------------------------------------------------ persistente --

// ¿Existe ya una fila de este mensaje en mensajes_grupos_sorteos PARA ESTE
// CLIENTE? Cuentan las filas del cliente receptor y las históricas sin
// cliente (cliente_usuario_id NULL: anteriores a la migración 028, todas de
// la única cuenta de entonces) — así un reenvío de un mensaje viejo no se
// reprocesa, sin atribuirle a esa fila ningún dueño. Sin la columna (028 sin
// aplicar) se usa la consulta de siempre, por (grupo_id, mensaje_id).
// Ante un error de lectura se devuelve false (se sigue el flujo de
// siempre): con Supabase caído el resto del pipeline tampoco puede
// escribir reservas/eventos, y bloquear aquí haría perder mensajes nuevos.
async function yaRegistrado({ remoteJid, mensajeId, clienteUsuarioId = null }) {

    try {

        const consulta = (conCliente) => {
            let q = supabase
                .from("mensajes_grupos_sorteos")
                .select("id")
                .eq("grupo_id", remoteJid)
                .eq("mensaje_id", mensajeId);
            if (conCliente) q = q.or(`cliente_usuario_id.eq.${clienteUsuarioId},cliente_usuario_id.is.null`);
            return q.limit(1);
        };

        let { data, error } = await consulta(!!clienteUsuarioId);

        if (error?.code === "42703" && clienteUsuarioId) {
            ({ data, error } = await consulta(false));
        }

        if (error) {

            console.error("⚠️ [COMPUERTA] no se pudo verificar si el mensaje ya existe (se continúa):", error.message);

            return false;

        }

        return Array.isArray(data) && data.length > 0;

    } catch (err) {

        console.error("⚠️ [COMPUERTA] excepción verificando si el mensaje ya existe (se continúa):", err?.message);

        return false;

    }

}

// Solo para pruebas.
function _reiniciarMemoria() {
    enVuelo.clear();
    recientes.clear();
}

module.exports = {
    MOTIVOS,
    TOLERANCIA_RELOJ_MS,
    identidadMensaje,
    clasificarIngreso,
    tomarEnMemoria,
    liberarEnMemoria,
    yaRegistrado,
    _reiniciarMemoria
};
