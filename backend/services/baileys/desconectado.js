const { DisconnectReason } = require("@whiskeysockets/baileys");
const supabase = require("../../lib/supabase");
const lease = require("./lease");

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

        // Desconexión definitiva: liberar el lease distribuido (LOCAL/VPS)
        // para que otra instancia pueda adquirirlo sin esperar el TTL, y
        // dejar que el manager decida el failover entre sesiones propias.
        await lease.soltar(sessionId);

        await manager.manejarDesconexionActiva(sessionId);

        return;
    }

    // Reinicio requerido: se reintenta la MISMA sesión, no es un caso de
    // failover (no se toca activeSession ni el listener del BOT).
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

        // Desconexión definitiva: liberar el lease distribuido (LOCAL/VPS)
        // para que otra instancia pueda adquirirlo sin esperar el TTL, y
        // dejar que el manager decida el failover entre sesiones propias.
        await lease.soltar(sessionId);

        await manager.manejarDesconexionActiva(sessionId);

        return;
    }

    // Conflict/replaced: otra conexión (real o, si había una condición de
    // carrera, un segundo socket nuestro) tomó el control de la MISMA
    // identidad de WhatsApp. Esto NO es un corte de red transitorio: si se
    // reintenta de inmediato con las mismas credenciales sin más, lo más
    // probable es volver a chocar con lo que sea que sigue vivo del otro
    // lado, produciendo el bucle infinito conflict/replaced observado en
    // producción/local. Por eso esta rama NUNCA llama a manager.start()
    // automáticamente — solo limpia el socket y, si esta sesión era la
    // activa del BOT, deja que el manager decida el failover desde su
    // único punto de decisión (manejarDesconexionActiva), igual que ya
    // hace para 403/401/408. No se cambia la política de failover entre
    // sesiones: se reutiliza tal cual la que ya existía para esos casos.
    if (statusCode === DisconnectReason.connectionReplaced) {

        console.log("⚠️ Conexión reemplazada (conflict/replaced, 440):", sessionId);

        sockets.delete(sessionId);

        await supabase
            .from("sesiones")
            .update({
                estado: "desconectado"
            })
            .eq("id", sessionId);

        // Liberar el lease distribuido: esta instancia ya no debe seguir
        // siendo dueña de una sesión que WhatsApp acaba de reemplazar; si
        // el "otro lado" es la otra instancia (LOCAL/VPS), que quede libre
        // para tomar el lease en su próximo intento.
        await lease.soltar(sessionId);

        await manager.manejarDesconexionActiva(sessionId);

        return;
    }

    // ⛔ No reconectar si el QR terminó de generar intentos
    if (statusCode === 408) {

        console.log("⌛ Fin de intentos del QR. No se reconecta.");

        sockets.delete(sessionId);

        // Desconexión definitiva: liberar el lease distribuido (LOCAL/VPS)
        // para que otra instancia pueda adquirirlo sin esperar el TTL, y
        // dejar que el manager decida el failover entre sesiones propias.
        await lease.soltar(sessionId);

        await manager.manejarDesconexionActiva(sessionId);

        return;
    }

    // Errores temporales: se reintenta la MISMA sesión, no es un caso de
    // failover (no se toca activeSession ni el listener del BOT).
    console.log("♻️ Reconexión temporal...");

    sockets.delete(sessionId);

    setTimeout(() => {

        manager.start(sessionId);

    }, 5000);

}

module.exports = desconectado;