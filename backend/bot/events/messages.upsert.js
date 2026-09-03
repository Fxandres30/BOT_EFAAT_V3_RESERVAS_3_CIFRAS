const messageHandler = require("../handlers/messageHandler");

const listeners = new Map();

function registerMessages(sock, sessionId) {

    unregisterMessages(sessionId);

    const context = sock.context || {};

    const listener = async ({ messages, type }) => {

        console.log("================================");
        console.log("📨 MESSAGES.UPSERT");
        console.log("TYPE:", type);
        console.log("MENSAJES:", messages?.length || 0);
        console.log("================================");

        if (!messages || messages.length === 0) {
            return;
        }

        for (const message of messages) {

            try {

                if (!message.message) {

                    console.log("⏭️ Mensaje vacío, ignorado");

                    continue;

                }

                const traceId = message.key.id;

                const remoto = message.key.remoteJid;

                let tipo = "PRIVADO";

                if (remoto.endsWith("@g.us"))
                    tipo = "GRUPO";

                else if (remoto === "status@broadcast")
                    tipo = "ESTADO";

                else if (remoto.endsWith("@newsletter"))
                    tipo = "NEWSLETTER";

                console.log(`📩 [${tipo}] ${remoto} | ${traceId}`);

                console.log(`➡️ ANTES messageHandler [${traceId}]`);

                console.time(`messageHandler-${traceId}`);

                await messageHandler({

                    sock,

                    session: context,

                    message,

                    tipo

                });

                console.timeEnd(`messageHandler-${traceId}`);

                console.log(`✅ DESPUÉS messageHandler [${traceId}]`);

            }

            catch (err) {

                console.error(`❌ Error procesando mensaje [${message.key.id}]`);

                console.error(err);

            }

        }

    };

    sock.ev.on("messages.upsert", listener);

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

📡 Listener registrado correctamente

═══════════════════════════════════════
`);

}

function unregisterMessages(sessionId) {

    const data = listeners.get(sessionId);

    if (!data)
        return;

    console.log(`🗑️ Eliminando listener: ${sessionId}`);

    data.sock.ev.off(
        "messages.upsert",
        data.listener
    );

    listeners.delete(sessionId);

}

module.exports = {

    registerMessages,

    unregisterMessages

};