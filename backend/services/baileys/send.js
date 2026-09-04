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

        // ===== INSTRUMENTACIÓN TEMPORAL DE DIAGNÓSTICO (a eliminar) =====
        // Compara la identidad exacta del socket que llegó como ctx.sock
        // contra el socket que el manager considera activo AHORA MISMO, y
        // envuelve la llamada real de Baileys en un Promise.race puramente
        // observacional: si tarda más de 10s se registra el timeout de
        // diagnóstico, pero se sigue esperando la promesa real y se
        // devuelve/lanza exactamente lo que Baileys resuelva o rechace —
        // el comportamiento del envío NO cambia.
        const socketManagerActivo = manager.getActiveSocket();

        console.log("[REAL SEND 1] antes de socketActivo.sendMessage", {
            jid,
            sessionId: idSesion.sessionId,
            estadoSesion: idSesion.estado,
            ctxSockEsMismaReferenciaQueActiveSocket: socketActivo === socketManagerActivo,
            ctxSockSessionId: idSesion.sessionId,
            activeSocketSessionId: identidadDesdeSocket(socketManagerActivo).sessionId,
            activeSocketEstado: identidadDesdeSocket(socketManagerActivo).estado,
            usoFallbackSocketActivo: !sock
        });

        const DIAG_TIMEOUT = Symbol("diag-timeout");

        const sendPromise = socketActivo.sendMessage(
            jid,
            { text: texto },
            quoted ? { quoted } : undefined
        );

        const diagTimeoutPromise = new Promise(resolve => {
            setTimeout(() => resolve(DIAG_TIMEOUT), 10000);
        });

        const raceResultado = await Promise.race([sendPromise, diagTimeoutPromise]);

        if (raceResultado === DIAG_TIMEOUT) {

            console.log("[REAL SEND TIMEOUT] sendMessage no resolvió en 10s", {
                jid,
                sessionId: idSesion.sessionId,
                ctxSockEsMismaReferenciaQueActiveSocket: socketActivo === manager.getActiveSocket()
            });

        }

        const resultado = raceResultado === DIAG_TIMEOUT
            ? await sendPromise
            : raceResultado;

        console.log("[REAL SEND 2] sendMessage RESOLVIÓ", {
            jid,
            tardoMasDe10s: raceResultado === DIAG_TIMEOUT
        });
        // ===== FIN INSTRUMENTACIÓN TEMPORAL =====

        // Enviar mensaje (citando el mensaje original cuando esté disponible)
        return resultado;

    }

    catch (error) {

        // Trazabilidad del fallo de envío — SOLO log, se re-lanza igual.
        const idSesion = identidadDesdeSocket(socketActivo);

        console.log("[REAL SEND ERROR]", {
            jid,
            sessionId: idSesion.sessionId,
            motivo: error.message
        });

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