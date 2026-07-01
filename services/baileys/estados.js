const guardarQR = require("./qr");
const conectado = require("./conectado");
const desconectado = require("./desconectado");

function registrarEstados(
    sock,
    sessionId,
    contexto
) {

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

                // ==========================
                // QR
                // ==========================
                if (qr) {

                    await guardarQR(

                        sessionId,
                        qr,
                        sock,
                        contexto

                    );

                }

                // ==========================
                // CONECTADO
                // ==========================
                if (connection === "open") {

                    await conectado(

                        sessionId,
                        sock,
                        contexto

                    );

                }

                // ==========================
                // DESCONECTADO
                // ==========================
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