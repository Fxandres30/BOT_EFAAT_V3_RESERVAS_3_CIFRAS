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

    try {

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

            console.error("⚠️ Error actualizando la sesión:");
            console.dir(error, { depth: null });

        }

    } catch (err) {

        console.error("⚠️ Error conectando con Supabase:");
        console.dir(err, { depth: null });

    }

    // Establecer sesión activa si aún no existe
    if (!contexto.manager.getActiveSession()) {

        const ok = await contexto.manager.setActive(sessionId);

        if (!ok) {

            console.error("❌ No se pudo establecer la sesión activa.");

            return;

        }

    }

    // Esperar un momento e iniciar el bot
    setTimeout(() => {

        const iniciarBot = require("../../bot");

        iniciarBot(sock, sessionId);

    }, 1000);

}

module.exports = conectado;