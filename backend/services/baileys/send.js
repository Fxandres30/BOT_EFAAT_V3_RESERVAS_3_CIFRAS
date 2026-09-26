const { generateMessageIDV2 } = require("@whiskeysockets/baileys");

const manager = require("./manager");
const {
    identidadDesdeSocket,
    maskPhone,
    tipoDestino
} = require("./identidadSesion");
const { registrarEnviado } = require("../../bot/utils/mensajesEnviados");

// Genera el id del mensaje ANTES de enviarlo y lo marca como "salida del
// programa", para que su eco en messages.upsert no se procese como entrada
// de usuario (ver bot/utils/mensajesEnviados.js). Mismo generador que usa
// Baileys por defecto; se le pasa como `messageId`.
function prepararIdSalida(socket) {

    const messageId = generateMessageIDV2(socket?.user?.id);
    registrarEnviado(messageId);
    return messageId;

}

// Los JID (contienen el teléfono) solo se loguean enmascarados.
const { enmascararJid } = require("../../bot/utils/enmascararJid");

function esperar(ms) {

    return new Promise(resolve =>
        setTimeout(resolve, ms));

}

// Prioriza el socket que realmente recibió/originó la acción (ctx.sock /
// llamador explícito). Fallback a la sesión activa solo por compatibilidad
// — misma regla para cualquier tipo de envío (texto o imagen), un único
// lugar que la decide.
function resolverSocketEnvio(sock) {

    const socketActivo = sock || manager.getActiveSocket();

    if (!socketActivo) {
        throw new Error("No hay una sesión activa.");
    }

    return socketActivo;

}

async function sendMessage({ sock, jid, text, quoted } = {}) {

    const socketActivo = resolverSocketEnvio(sock);

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
            jid: enmascararJid(jid),
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
            jid: enmascararJid(jid),
            sessionId: idSesion.sessionId,
            estadoSesion: idSesion.estado,
            ctxSockEsMismaReferenciaQueActiveSocket: socketActivo === socketManagerActivo,
            ctxSockSessionId: idSesion.sessionId,
            activeSocketSessionId: identidadDesdeSocket(socketManagerActivo).sessionId,
            activeSocketEstado: identidadDesdeSocket(socketManagerActivo).estado,
            usoFallbackSocketActivo: !sock
        });

        const DIAG_TIMEOUT = Symbol("diag-timeout");

        const messageId = prepararIdSalida(socketActivo);

        const sendPromise = socketActivo.sendMessage(
            jid,
            { text: texto },
            quoted ? { quoted, messageId } : { messageId }
        );

        const diagTimeoutPromise = new Promise(resolve => {
            setTimeout(() => resolve(DIAG_TIMEOUT), 10000);
        });

        const raceResultado = await Promise.race([sendPromise, diagTimeoutPromise]);

        if (raceResultado === DIAG_TIMEOUT) {

            console.log("[REAL SEND TIMEOUT] sendMessage no resolvió en 10s", {
                jid: enmascararJid(jid),
                sessionId: idSesion.sessionId,
                ctxSockEsMismaReferenciaQueActiveSocket: socketActivo === manager.getActiveSocket()
            });

        }

        const resultado = raceResultado === DIAG_TIMEOUT
            ? await sendPromise
            : raceResultado;

        console.log("[REAL SEND 2] sendMessage RESOLVIÓ", {
            jid: enmascararJid(jid),
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
            jid: enmascararJid(jid),
            sessionId: idSesion.sessionId,
            motivo: error.message
        });

        console.log("📤 [WHATSAPP SEND ERROR]", {
            sesion: idSesion.nombre,
            sessionId: idSesion.sessionId,
            destino: tipoDestino(jid),
            jid: enmascararJid(jid),
            motivo: error.message
        });

        console.error(
            "❌ Error enviando mensaje:",
            error
        );

        throw error;

    }

}

// sendImage({ sock, jid, image, caption }) — envío real de imagen +
// texto (Baileys soporta { image, caption } de forma nativa). Usado por
// compartirTabla.js — única función de envío de imagen del proyecto, para
// que "compartir" manual y automático usen exactamente el mismo camino
// real, igual que sendMessage ya es el único camino para texto.
async function sendImage({ sock, jid, image, caption } = {}) {

    const socketActivo = resolverSocketEnvio(sock);

    try {

        const idSesion = identidadDesdeSocket(socketActivo);

        console.log("📤 [WHATSAPP SEND IMAGE]", {
            sesion: idSesion.nombre,
            telefono: maskPhone(idSesion.telefono),
            sessionId: idSesion.sessionId,
            destino: tipoDestino(jid),
            jid: enmascararJid(jid),
            longitudCaption: (caption || "").length,
            bytesImagen: image?.length || 0
        });

        return await socketActivo.sendMessage(
            jid,
            { image, caption: caption || "" },
            { messageId: prepararIdSalida(socketActivo) }
        );

    } catch (error) {

        const idSesion = identidadDesdeSocket(socketActivo);

        console.log("📤 [WHATSAPP SEND IMAGE ERROR]", {
            sesion: idSesion.nombre,
            sessionId: idSesion.sessionId,
            jid: enmascararJid(jid),
            motivo: error.message
        });

        throw error;

    }

}

module.exports = {

    sendMessage,
    sendImage

};