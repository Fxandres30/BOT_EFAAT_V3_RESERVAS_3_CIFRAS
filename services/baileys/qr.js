const QRCode = require("qrcode");

const supabase = require("../../lib/supabase");

const {
    iniciarTimeout
} = require("./timeout");

async function guardarQR(
    sessionId,
    qr,
    sock,
    contexto
) {

    console.log("QR RECIBIDO");

    try {

        const qrBase64 =
            await QRCode.toDataURL(qr);

        const { error } =
            await supabase

                .from("sesiones")

                .update({

                    qr: qrBase64,
                    estado: "esperando_qr"

                })

                .eq("id", sessionId);

        console.log("QR ERROR:", error);

        iniciarTimeout(

            sessionId,
            sock,
            contexto.sockets

        );

    }

    catch (err) {

        console.log(

            "ERROR GENERANDO QR:",
            err

        );

    }

}

module.exports = guardarQR;