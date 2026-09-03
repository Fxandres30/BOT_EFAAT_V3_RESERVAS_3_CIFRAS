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

    // La decisión de si esta sesión debe convertirse en la sesión activa
    // del BOT (o simplemente quedar disponible) la toma el SessionManager
    // de forma centralizada (Fase 5.1) — nunca esta función directamente.
    setTimeout(() => {

        contexto.manager.evaluarConexion(sessionId).catch(err => {

            console.error("❌ Error evaluando conexión:", err.message);

        });

    }, 1000);

}

module.exports = conectado;