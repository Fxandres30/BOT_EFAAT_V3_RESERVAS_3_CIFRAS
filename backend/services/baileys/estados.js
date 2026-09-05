const guardarQR = require("./qr");
const conectado = require("./conectado");
const desconectado = require("./desconectado");

function registrarEstados(
    sock,
    sessionId,
    contexto
) {

    if (!sock) {

        console.error(`❌ Socket nulo para la sesión ${sessionId}`);

        return;

    }

    sock.ev.on(

        "connection.update",

        async (update) => {

            try {

                // Guardia de identidad: este listener quedó atado a UNA
                // instancia concreta de socket (closure sobre `sock`) en el
                // momento del registro. Si para entonces `sessionId` ya
                // apunta a OTRO socket en el Map (p. ej. este socket fue
                // reemplazado y ya no es el vigente), cualquier evento
                // tardío de este socket viejo/muerto se ignora aquí — así
                // una señal tardía de un socket reemplazado nunca puede
                // borrar, tocar el estado o disparar una reconexión sobre
                // el socket nuevo de la misma sesión.
                if (contexto.sockets.get(sessionId) !== sock) {

                    console.log(`⏭️ [SESSION] Evento de connection.update ignorado (socket obsoleto para ${sessionId})`);

                    return;

                }

                console.log("UPDATE:", update);

                const {
                    connection,
                    qr,
                    lastDisconnect
                } = update;

                if (qr) {

                    await guardarQR(
                        sessionId,
                        qr,
                        sock,
                        contexto
                    );

                }

                if (connection === "open") {

                    await conectado(
                        sessionId,
                        sock,
                        contexto
                    );

                }

                if (connection === "close") {

                    // 👇 NUEVO: imprimir TODO el error
                    console.log("========== LAST DISCONNECT ==========");
                    console.dir(lastDisconnect, { depth: null });
                    console.log("=====================================");

                    console.log("========== ERROR ==========");
                    console.dir(lastDisconnect?.error, { depth: null });
                    console.log("===========================");

                    const statusCode =
                        lastDisconnect?.error?.output?.statusCode;

                    await desconectado(
                        sessionId,
                        statusCode,
                        contexto
                    );

                }

            } catch (err) {

                console.error(
                    "❌ Error en connection.update:",
                    err
                );

            }

        }

    );

}

module.exports = registrarEstados;