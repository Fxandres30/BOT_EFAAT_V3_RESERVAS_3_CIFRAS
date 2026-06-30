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
                    sock
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

        }

    );

}

module.exports = registrarEstados;