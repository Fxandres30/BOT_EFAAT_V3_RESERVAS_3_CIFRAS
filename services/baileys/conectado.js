const supabase = require("../../lib/supabase");

const {
    cancelarTimeout
} = require("./timeout");

async function conectado(
    sessionId,
    sock,
    contexto
) {

    // Cancelar el contador del QR
    cancelarTimeout(sessionId);

    console.log("🟢 CONECTADO:", sessionId);

    const numero =
        sock.user?.id?.split(":")[0] || null;

    const { error } = await supabase

        .from("sesiones")

        .update({

            telefono: numero,

            estado: "conectado",

            qr: null,

            qr_generado_en: null,

            qr_expira_en: null

        })

        .eq("id", sessionId);

    if (error) {

        console.error("OPEN ERROR:", error);

        return;

    }

    // Si todavía no existe una sesión activa,
    // esta será la primera.
    if (!contexto.manager.getActiveSession()) {

        const ok = await contexto.manager.setActive(sessionId);

        if (!ok) {

            console.error("❌ No se pudo establecer la sesión activa.");

            return;

        }

    }

    // Esperar un momento para iniciar el bot
    setTimeout(() => {

        const iniciarBot = require("../../bot");

        iniciarBot();

    }, 1000);

}

module.exports = conectado;