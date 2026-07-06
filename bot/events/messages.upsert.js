const messageHandler = require("../handlers/messageHandler");

const listeners = new Map();

function registerMessages(sock, sessionId) {

    unregisterMessages(sessionId);

    const context = sock.context || {};

    const listener = async ({ messages }) => {

        console.log(
            `\n📨 ${messages.length} mensaje(s) recibido(s) | 📱 ${context.telefono || "Sin número"}`
        );

        for (const message of messages) {

            try {

                if (!message.message)
                    continue;

                const remoto = message.key.remoteJid;

                let tipo = "PRIVADO";

                if (remoto.endsWith("@g.us"))
                    tipo = "GRUPO";

                else if (remoto === "status@broadcast")
                    tipo = "ESTADO";

                else if (remoto.endsWith("@newsletter"))
                    tipo = "NEWSLETTER";

                console.log(
                    `📩 [${tipo}]`,
                    remoto,
                    "|",
                    message.key.id
                );

                await messageHandler(
                    sock,
                    message
                );

            }

            catch (err) {

                console.error(
                    "❌ Error procesando mensaje:"
                );

                console.error(err);

            }

        }

    };

    sock.ev.on(
        "messages.upsert",
        listener
    );

    listeners.set(sessionId, {

        sock,

        listener

    });

    console.log(`
═══════════════════════════════════════

🤖 BOT ESCUCHANDO

📱 Número : ${context.telefono || "Desconocido"}

🆔 Sesión : ${sessionId}

👤 Usuario : ${context.usuarioId || "Sin usuario"}

📡 Estado : Escuchando mensajes

═══════════════════════════════════════
`);

}

function unregisterMessages(sessionId) {

    const data = listeners.get(sessionId);

    if (!data)
        return;

    data.sock.ev.off(
        "messages.upsert",
        data.listener
    );

    listeners.delete(sessionId);

    console.log(`
🔇 Listener eliminado

🆔 Sesión : ${sessionId}
`);

}

module.exports = {

    registerMessages,

    unregisterMessages

};