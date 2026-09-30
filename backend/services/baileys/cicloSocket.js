// ==========================================================================
// CICLO DE VIDA REAL DE CADA INSTANCIA DE SOCKET (Fase 1)
// ==========================================================================
// Estado por INSTANCIA de socket (no por sesión: una misma sesión que
// reconecta produce un socket nuevo con su propio ciclo):
//
//   connecting       -> recién creado (makeWASocket), todavía sin handshake.
//                       Estar en el Map de sockets NO significa conectado.
//   open             -> Baileys confirmó connection === "open".
//   pending_flushed  -> además, WhatsApp terminó de entregar lo pendiente
//                       (receivedPendingNotifications === true).
//   closed           -> connection === "close". Terminal: un socket cerrado
//                       nunca vuelve a abrirse (la reconexión crea otro).
//
// "Conectado" = open o pending_flushed. Lo alimenta ÚNICAMENTE estados.js
// (primera línea de su listener de connection.update, antes de la guardia
// de socket obsoleto, para que también un socket reemplazado quede
// "closed"). Sin efectos secundarios: solo guarda y consulta estado.
// ==========================================================================

const CONNECTING = "connecting";
const OPEN = "open";
const PENDING_FLUSHED = "pending_flushed";
const CLOSED = "closed";

const estados = new WeakMap(); // sock -> { estado, pendientesRecibidos }

function registrarSocket(sock) {

    if (!sock) return;

    estados.set(sock, { estado: CONNECTING, pendientesRecibidos: false });

}

function actualizarDesdeUpdate(sock, update) {

    const actual = sock ? estados.get(sock) : null;

    if (!actual || !update || actual.estado === CLOSED) return;

    if (update.connection === "close") {
        actual.estado = CLOSED;
        return;
    }

    if (update.receivedPendingNotifications === true) {
        actual.pendientesRecibidos = true;
    }

    if (update.connection === "open") {
        actual.estado = OPEN;
    }

    if (actual.estado === OPEN && actual.pendientesRecibidos) {
        actual.estado = PENDING_FLUSHED;
    }

}

function estadoDe(sock) {

    return (sock && estados.get(sock)?.estado) || null;

}

function estaAbierto(sock) {

    const estado = estadoDe(sock);

    return estado === OPEN || estado === PENDING_FLUSHED;

}

module.exports = {
    CONNECTING,
    OPEN,
    PENDING_FLUSHED,
    CLOSED,
    registrarSocket,
    actualizarDesdeUpdate,
    estadoDe,
    estaAbierto
};
