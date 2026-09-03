const manager = require("./manager");
const {
    identidadDesdeSocket,
    maskPhone,
    tipoDestino
} = require("./identidadSesion");

function esperar(ms) {

    return new Promise(resolve =>
        setTimeout(resolve, ms));

}

async function sendMessage({ sock, jid, text, quoted } = {}) {

    // Prioriza el socket que realmente recibió el mensaje (ctx.sock).
    // Fallback a la sesión activa solo por compatibilidad.
    const socketActivo = sock || manager.getActiveSocket();

    if (!socketActivo) {

        throw new Error("No hay una sesión activa.");

    }

    try {

        // Mostrar "escribiendo..."
        await socketActivo.sendPresenceUpdate(
            "composing",
            jid
        );

        // Obtener el texto
        const texto = text || "";

        // Tiempo base
        let tiempo = 800;

        // Más largo = más espera
        tiempo += texto.length * 35;

        // Aleatorio
        tiempo += Math.floor(
            Math.random() * 1800
        );

        // Nunca menos de 1 segundo
        tiempo = Math.max(
            tiempo,
            1000
        );

        // Nunca más de 7 segundos
        tiempo = Math.min(
            tiempo,
            7000
        );

        await esperar(tiempo);

        // Dejar de escribir
        await socketActivo.sendPresenceUpdate(
            "paused",
            jid
        );

        // ─────────────────────────────────────────────────────────────
        // TRAZABILIDAD (Fase de observabilidad) — SOLO log interno.
        // No altera el texto, el socket, el quoted ni el envío.
        // ─────────────────────────────────────────────────────────────
        const idSesion = identidadDesdeSocket(socketActivo);

        console.log("📤 [WHATSAPP SEND]", {
            sesion: idSesion.nombre,
            telefono: maskPhone(idSesion.telefono),
            sessionId: idSesion.sessionId,
            estadoSesion: idSesion.estado,
            esSocketActivo: socketActivo === manager.getActiveSocket(),
            usoFallbackSocketActivo: !sock,
            destino: tipoDestino(jid),
            jid,
            tipo: "respuesta_bot",
            longitudTexto: texto.length
        });

        // Enviar mensaje (citando el mensaje original cuando esté disponible)
        return await socketActivo.sendMessage(
            jid,
            { text: texto },
            quoted ? { quoted } : undefined
        );

    }

    catch (error) {

        // Trazabilidad del fallo de envío — SOLO log, se re-lanza igual.
        const idSesion = identidadDesdeSocket(socketActivo);

        console.log("📤 [WHATSAPP SEND ERROR]", {
            sesion: idSesion.nombre,
            sessionId: idSesion.sessionId,
            destino: tipoDestino(jid),
            jid,
            motivo: error.message
        });

        console.error(
            "❌ Error enviando mensaje:",
            error
        );

        throw error;

    }

}

module.exports = {

    sendMessage

};