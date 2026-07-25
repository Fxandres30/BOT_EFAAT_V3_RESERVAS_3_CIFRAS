const { DisconnectReason } = require("@whiskeysockets/baileys");
const supabase = require("../../lib/supabase");

async function desconectado(sessionId, statusCode, contexto) {

    const { sockets, manager } = contexto;

    console.log("STATUS:", statusCode);

    // WhatsApp rechazó la sesión
    if (statusCode === 403) {

        console.log("❌ Sesión rechazada por WhatsApp:", sessionId);

        sockets.delete(sessionId);

        await supabase
            .from("sesiones")
            .update({
                estado: "bloqueado"
            })
            .eq("id", sessionId);

        return;

    }

    // Reinicio requerido
    if (statusCode === DisconnectReason.restartRequired) {

        console.log("🔄 Reiniciando...");

        sockets.delete(sessionId);

        return manager.start(sessionId);

    }

    // Logout o QR expirado
    if (
        statusCode === 401 ||
        statusCode === DisconnectReason.loggedOut
    ) {

        console.log("❌ Logout / QR expirado");

        sockets.delete(sessionId);

        await supabase
            .from("sesiones")
            .update({

                estado: "desconectado",

                telefono: null,

                qr: null,

                qr_generado_en: null,

                qr_expira_en: null

            })
            .eq("id", sessionId);

        return;

    }

    // Errores temporales
    console.log("♻️ Reconexión temporal...");

    sockets.delete(sessionId);

    setTimeout(() => {

        manager.start(sessionId);

    }, 5000);

}

module.exports = desconectado;