const manager = require("../services/baileys/manager");

const {
    registerMessages,
    unregisterMessages
} = require("./events/messages.upsert");

let socketActual = null;
let sesionActual = null;
let iniciado = false;

function conectar(socket, sessionId) {

    if (sesionActual === sessionId) {
        return;
    }

    if (socketActual) {
        unregisterMessages(sesionActual);
    }

    socketActual = socket;
    sesionActual = sessionId;

    console.log(`🤖 BOT ESCUCHANDO: ${sessionId}`);

    registerMessages(socket, sessionId);

}

function iniciarBot() {

    if (!iniciado) {

        manager.on("activeChanged", ({ socket, sessionId }) => {

            conectar(socket, sessionId);

        });

        iniciado = true;

    }

    const socket = manager.getActiveSocket();
    const sessionId = manager.getActiveSession();

    if (!socket || !sessionId) {

        console.log("⚠️ No existe una sesión activa.");

        return;

    }

    conectar(socket, sessionId);

}

module.exports = iniciarBot;