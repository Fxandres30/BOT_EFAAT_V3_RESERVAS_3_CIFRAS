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

    if (!socket || !sessionId) {

        return;

    }

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

    // =====================================
    // Iniciar worker de eventos
    // =====================================

    iniciarWorkerEventos(socket);

}

function iniciarBot(sock, sessionId) {

    if (!iniciado) {

        manager.on("activeChanged", ({ socket, sessionId }) => {

            conectar(socket, sessionId);

        });

        iniciado = true;

    }

    // Si conectado.js envía socket y sessionId,
    // usamos esos directamente.
    if (sock && sessionId) {

        conectar(sock, sessionId);

        return;

    }

    // Fallback a la sesión activa
    const socket = manager.getActiveSocket();
    const session = manager.getActiveSession();

    if (!socket || !session) {

        console.log("⚠️ No existe una sesión activa.");

        return;

    }

    conectar(socket, session);

}

module.exports = iniciarBot;