const manager = require("../services/baileys/manager");

const {
    registerMessages,
    unregisterMessages
} = require("./events/messages.upsert");

let socketActual = null;
let sesionActual = null;
let iniciado = false;

function conectar(socket, sessionId) {

    // Ya estamos escuchando esa sesión
    if (sesionActual === sessionId) {

        return;

    }

    // Quitar listener de la sesión anterior
    if (socketActual && sesionActual) {

        unregisterMessages(
            socketActual,
            sesionActual
        );

    }

    socketActual = socket;
    sesionActual = sessionId;

    console.log("🤖 BOT ESCUCHANDO:", sessionId);

    registerMessages(
        socket,
        sessionId
    );

}

function iniciarBot() {

    // Registrar el evento UNA sola vez
    if (!iniciado) {

        manager.on(

            "activeChanged",

            ({ socket, sessionId }) => {

                console.log(
                    "🔄 Cambiando BOT a:",
                    sessionId
                );

                conectar(
                    socket,
                    sessionId
                );

            }

        );

        iniciado = true;

    }

    // Conectarse a la sesión activa actual
    const socket =
        manager.getActiveSocket();

    const sessionId =
        manager.getActiveSession();

    if (!socket || !sessionId) {

        console.log("❌ No hay sesión activa.");

        return;

    }

    conectar(
        socket,
        sessionId
    );

}

module.exports = iniciarBot;