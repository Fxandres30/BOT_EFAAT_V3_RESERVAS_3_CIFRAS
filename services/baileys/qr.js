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

        const qrBase64 = await QRCode.toDataURL(qr);

        // Consultar el estado actual de la sesión
        const { data: session, error: selectError } = await supabase

    .from("sesiones")

    .select("qr_generado_en, qr_expira_en")

    .eq("id", sessionId)

    .maybeSingle();

if (selectError) {

    console.error("❌ Error obteniendo sesión:", selectError.message);

    return;

}

if (!session) {

    console.log(`⚠️ La sesión ${sessionId} ya no existe. Ignorando QR.`);

    return;

}

        // Primer QR
        if (!session.qr_generado_en) {

            const ahora = new Date();

            const expira = new Date(
                ahora.getTime() + (3 * 60 * 1000)
            );

            const { error } = await supabase

                .from("sesiones")

                .update({

                    qr: qrBase64,

                    estado: "esperando_qr",

                    qr_generado_en: ahora.toISOString(),

                    qr_expira_en: expira.toISOString()

                })

                .eq("id", sessionId);

            if (error) {

                console.error(error);

                return;

            }

            console.log("🟢 Primer QR guardado");

            iniciarTimeout(
                sessionId,
                sock,
                contexto.sockets
            );

        }

        // QR renovado por Baileys
        else {

            const { error } = await supabase

                .from("sesiones")

                .update({

                    qr: qrBase64,

                    estado: "esperando_qr"

                })

                .eq("id", sessionId);

            if (error) {

                console.error(error);

                return;

            }

            console.log("🔄 QR actualizado (sin reiniciar tiempo)");

        }

    }

    catch (err) {

        console.log(
            "ERROR GENERANDO QR:",
            err
        );

    }

}

module.exports = guardarQR;