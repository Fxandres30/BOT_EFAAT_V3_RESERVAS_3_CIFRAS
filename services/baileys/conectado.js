const supabase = require("../../lib/supabase");

const {
    cancelarTimeout
} = require("./timeout");

async function conectado(
    sessionId,
    sock,
    contexto
) {

    cancelarTimeout(sessionId);

    console.log("🟢 CONECTADO:", sessionId);

    const numero =
        sock.user?.id?.split(":")[0] || null;

    const { error } = await supabase
        .from("sesiones")
        .update({

            telefono: numero,
            estado: "conectado",
            qr: null

        })
        .eq("id", sessionId);

    console.log("OPEN ERROR:", error);

    // Si todavía no existe una sesión activa,
    // esta será la primera.
    if (!contexto.manager.getActiveSession()) {

        contexto.manager.setActive(sessionId);

    }

    // Esperar un instante para que el manager
    // termine de actualizar la sesión activa.
    setTimeout(() => {

        const iniciarBot =
            require("../../bot");

        iniciarBot();

    }, 1000);

}

module.exports = conectado;