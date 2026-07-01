const { DisconnectReason } = require("@whiskeysockets/baileys");

const supabase = require("../../lib/supabase");

async function desconectado(
    sessionId,
    statusCode,
    contexto
) {

    const {

        sockets,
        manager

    } = contexto;

    console.log("STATUS:", statusCode);

    // ==========================
    // REINICIO
    // ==========================
    if (statusCode === DisconnectReason.restartRequired) {

        console.log("🔄 Reiniciando socket...");

        sockets.delete(sessionId);

        return manager.start(sessionId);

    }

    // ==========================
    // SESIÓN CERRADA
    // ==========================
    if (statusCode === DisconnectReason.loggedOut) {

        console.log("❌ Sesión cerrada");

        await supabase
            .from("sesiones")
            .update({

                estado: "desconectado",
                telefono: null,
                qr: null

            })
            .eq("id", sessionId);

        sockets.delete(sessionId);

        // Si era la sesión activa,
        // buscar otra automáticamente.
        if (manager.isActive(sessionId)) {

            manager.activeSession = null;

            const disponibles = manager.getAll();

            if (disponibles.length > 0) {

                manager.setActive(

                    disponibles[0]

                );

            }

        }

        return;

    }

    // ==========================
    // RECONEXIÓN
    // ==========================
    console.log("♻️ Reconectando...");

    sockets.delete(sessionId);

    return manager.start(sessionId);

}

module.exports = desconectado;