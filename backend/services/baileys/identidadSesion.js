// ============================================================
// FASE DE OBSERVABILIDAD — utilidades de SOLO LECTURA
// ============================================================
//
// Este archivo NO participa en ninguna lógica de negocio. Lo importan
// únicamente los puntos de log de trazabilidad:
//   - services/baileys/send.js       (log de cada envío)
//   - services/baileys/manager.js    (log de failover)
//   - bot/index.js                   (log de sesión activa)
//
// Lee EXCLUSIVAMENTE sock.context, que se adjunta al socket en
// socket.js al crearlo y contiene:
//   { sessionId, usuarioId, telefono, nombreSesion, estado }
//
// NUNCA accede a credenciales, tokens, QR, ni al estado de auth de
// Baileys. No consulta Supabase. No tiene efectos secundarios.

function identidadDesdeSocket(sock) {

    const ctx = (sock && sock.context) || {};

    return {
        sessionId: ctx.sessionId ?? null,
        nombre: ctx.nombreSesion ?? null,
        telefono: ctx.telefono ?? null,
        estado: ctx.estado ?? null
    };

}

// Enmascara el teléfono: deja visible solo el prefijo (2 dígitos) y los
// 2 últimos dígitos. "573001234567" -> "57 ••• ••67". El número completo
// nunca se imprime en los logs.
function maskPhone(telefono) {

    if (!telefono) return null;

    const str = String(telefono).replace(/\D/g, "");

    if (str.length < 4) return "****";

    return `${str.slice(0, 2)} ••• ••${str.slice(-2)}`;

}

// Deriva el destino a partir del JID, sin tocar el envío.
function tipoDestino(jid) {

    if (typeof jid !== "string") return "desconocido";

    if (jid.endsWith("@g.us")) return "grupo";

    if (jid.endsWith("@newsletter")) return "newsletter";

    if (jid === "status@broadcast") return "estado";

    return "privado";

}

module.exports = {
    identidadDesdeSocket,
    maskPhone,
    tipoDestino
};
