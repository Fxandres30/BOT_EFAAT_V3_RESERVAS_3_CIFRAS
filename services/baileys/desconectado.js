const { DisconnectReason } = require("@whiskeysockets/baileys");
const supabase = require("../../lib/supabase");

async function desconectado(sessionId, statusCode, contexto) {

    const { sockets, manager } = contexto;

    console.log("STATUS:", statusCode);

    // Reinicio requerido
    if (statusCode === DisconnectReason.restartRequired) {

        console.log("🔄 Reiniciando...");

        sockets.delete(sessionId);

        return manager.start(sessionId);

    }

    // Logout REAL
    if (statusCode === DisconnectReason.loggedOut) {

        console.log("❌ Logout");

        sockets.delete(sessionId);

        await supabase
            .from("sesiones")
            .update({
                estado: "desconectado",
                telefono: null,
                qr: null
            })
            .eq("id", sessionId);

        if (manager.isActive(sessionId)) {

            manager.activeSession = null;

            const disponibles = manager.getAll();

            if (disponibles.length) {

                manager.setActive(disponibles[0]);

            }

        }

        return;

    }

    // Cualquier otro cierre => reconectar
    console.log("♻️ Reconectando...");

    sockets.delete(sessionId);

    setTimeout(() => {

        manager.start(sessionId);

    }, 2000);

}

module.exports = desconectado;