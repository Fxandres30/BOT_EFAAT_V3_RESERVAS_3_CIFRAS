const QRCode = require("qrcode");
const supabase = require("../../lib/supabase");

async function guardarQR(sessionId, qr) {

    console.log("QR RECIBIDO");

    try {

        const qrBase64 = await QRCode.toDataURL(qr);

        const { error } = await supabase
            .from("sesiones")
            .update({
                qr: qrBase64,
                estado: "esperando_qr"
            })
            .eq("id", sessionId);

        console.log("QR ERROR:", error);

    } catch (err) {

        console.log("ERROR GENERANDO QR:", err);

    }

}

module.exports = guardarQR;