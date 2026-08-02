const manager = require("../services/baileys/manager");

const {
    registerMessages,
    unregisterMessages
} = require("./events/messages.upsert");

const {
    iniciarWorkerEventos
} = require("./funciones/eventos/lifecycle/iniciarWorkerEventos");

let socketActual = null;
let sesionActual = null;
let iniciado = false;

function conectar(socket, sessionId) {

    console.log("================================");
    console.log("🔄 CONECTAR");
    console.log("Session nueva :", sessionId);
    console.log("Session actual:", sesionActual);
    console.log("Socket nuevo  :", socket === socketActual ? "NO" : "SI");
    console.log("================================");

    if (!socket || !sessionId) {

        console.log("❌ Socket o sessionId inválidos");

        return;

    }

    // Solo salir si ES EXACTAMENTE el mismo socket
    if (socketActual === socket && sesionActual === sessionId) {

        console.log("ℹ️ Ya estaba conectado exactamente el mismo socket.");

        return;

    }

    if (socketActual && sesionActual) {

        console.log("🗑️ Eliminando listeners anteriores");

        unregisterMessages(sesionActual);

    }

    socketActual = socket;
    sesionActual = sessionId;

    console.log("✅ Registrando listeners");

    registerMessages(socket, sessionId);

    console.log("✅ Iniciando worker");

    iniciarWorkerEventos(socket);

    console.log("✅ Conexión preparada");

}

function iniciarBot(sock, sessionId) {

    console.log("🚀 iniciarBot()");

    if (!iniciado) {

        console.log("📡 Registrando activeChanged");

        manager.on("activeChanged", ({ socket, sessionId }) => {

            console.log("⭐ activeChanged recibido:", sessionId);

            conectar(socket, sessionId);

        });

        iniciado = true;

    }

    if (sock && sessionId) {

        console.log("➡️ Inicio directo");

        conectar(sock, sessionId);

        return;

    }

    const socket = manager.getActiveSocket();
    const session = manager.getActiveSession();

    if (!socket || !session) {

        console.log("⚠️ No existe una sesión activa.");

        return;

    }

    console.log("➡️ Inicio por sesión activa");

    conectar(socket, session);

}

module.exports = iniciarBot;