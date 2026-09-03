// Punto de integración FASE 1: reserva exitosa -> IA -> WhatsApp.
// El BOT ya reservó los números y actualizó Supabase antes de llegar aquí
// (ver bot/handlers/eventHandler.js). Esta función SOLO redacta y envía
// el mensaje de confirmación; nunca decide ni modifica el negocio.
const { construirContextoReserva } = require("./contextBuilder");
const { suggestReply } = require("./aiService");
const { sendMessage } = require("../../services/baileys/send");

async function responderReserva(ctx) {

    const reserva = ctx.reserva;

    // FASE 2: responde tanto para reserva exitosa (ok:true) como para
    // reserva rechazada (ok:false). Silencio cuando reserva === null
    // (ya era del usuario, o no era una solicitud de reserva).
    if (!reserva || typeof reserva.mensaje !== "string") {
        return;
    }

    // Respuesta fija actual = fallback obligatorio si la IA falla o no está configurada.
    let texto = reserva.mensaje;
    let iaUtilizada = false;

    try {

        const contexto = construirContextoReserva(ctx);

        const sugerencia = await suggestReply(contexto);

        if (sugerencia?.respuesta) {

            texto = sugerencia.respuesta;
            iaUtilizada = true;

        }

    }

    catch (error) {

        console.log("⚠️ Fallback a respuesta fija (error inesperado en IA):", error.message);

    }

    const sessionId = ctx.session?.sessionId || null;
    const quotedMessageId = ctx.message?.key?.id || null;

    console.log("[RESPONSE]", {
        remoteJid: ctx.chat.remoteJid,
        fromMe: ctx.message.key.fromMe,
        sessionId,
        quotedMessageId,
        resultadoOk: reserva.ok ?? null,
        iaUtilizada,
        fallbackUtilizado: !iaUtilizada
    });

    try {

        await sendMessage({

            sock: ctx.sock,
            jid: ctx.chat.remoteJid,
            text: texto,
            quoted: ctx.message

        });

        console.log("[RESPONSE] envío exitoso →", ctx.chat.remoteJid);

    }

    catch (error) {

        console.log("[RESPONSE] envío con error →", error.message);

    }

}

module.exports = {
    responderReserva
};
