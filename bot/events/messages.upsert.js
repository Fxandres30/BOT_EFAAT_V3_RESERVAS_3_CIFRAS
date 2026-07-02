const messageHandler = require("../handlers/messageHandler");

const listeners = new Map();

function registerMessages(sock, sessionId) {

    // Si ya existía, eliminarlo primero
    unregisterMessages(sock, sessionId);

    const listener = async ({ messages }) => {

        for (const message of messages) {

            try {

                await messageHandler(sock, message);

            } catch (err) {

                console.log("❌ Error procesando mensaje:", err.message);

            }

        }

    };

    sock.ev.on("messages.upsert", listener);

    listeners.set(sessionId, {
        sock,
        listener
    });

    console.log("👂 Escuchando:", sessionId);

}

function unregisterMessages(sessionId) {

    const data = listeners.get(sessionId);

    if (!data) return;

    data.sock.ev.off(
        "messages.upsert",
        data.listener
    );

    listeners.delete(sessionId);

    console.log("🔇 Listener eliminado:", sessionId);

}

module.exports = {
    registerMessages,
    unregisterMessages
};