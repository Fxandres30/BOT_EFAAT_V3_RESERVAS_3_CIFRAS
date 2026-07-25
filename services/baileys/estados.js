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