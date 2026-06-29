const { DisconnectReason } = require("@whiskeysockets/baileys");

const supabase = require("../../lib/supabase");

async function desconectado(
    sessionId,
    statusCode,
    contexto
) {

    const {
        sockets,
        createSocket
    } = contexto;

    console.log("STATUS:", statusCode);

    if (statusCode === DisconnectReason.restartRequired) {

        console.log("REINICIANDO SOCKET...");

        sockets.delete(sessionId);

        return manager.start(sessionId);

    }

    if (statusCode === DisconnectReason.loggedOut) {

        console.log("SESION CERRADA");

        await supabase
            .from("sesiones")
            .update({

                estado: "desconectado",
                qr: null

            })
            .eq("id", sessionId);

        sockets.delete(sessionId);

        return;

    }

    console.log("RECONEXION...");

    sockets.delete(sessionId);

    return manager.start(sessionId);

}

module.exports = desconectado;