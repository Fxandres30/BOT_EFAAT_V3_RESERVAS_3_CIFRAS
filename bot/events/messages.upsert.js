const messageHandler =
require("../handlers/messageHandler");

// Un listener por sesión
const listeners = new Map();

function registerMessages(sock, sessionId) {

    // Si ya existe, no volver a registrarlo
    if (listeners.has(sessionId)) {

        console.log(
            "👂 Ya estaba escuchando:",
            sessionId
        );

        return;

    }

    const listener = async ({ messages }) => {

        for (const message of messages) {

            try {

                await messageHandler(

                    sock,

                    message

                );

            } catch (err) {

                console.log(
                    "❌ Error procesando mensaje:",
                    err.message
                );

            }

        }

    };

    sock.ev.on(

        "messages.upsert",

        listener

    );

    listeners.set(

        sessionId,

        listener

    );

    console.log(
        "👂 Escuchando:",
        sessionId
    );

}

function unregisterMessages(sock, sessionId) {

    const listener =
        listeners.get(sessionId);

    if (!listener) {

        return;

    }

    sock.ev.off(

        "messages.upsert",

        listener

    );

    listeners.delete(sessionId);

    console.log(
        "🔇 Listener eliminado:",
        sessionId
    );

}

module.exports = {

    registerMessages,

    unregisterMessages

};