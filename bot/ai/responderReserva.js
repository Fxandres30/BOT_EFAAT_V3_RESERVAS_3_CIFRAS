// Punto de integración FASE 1: reserva exitosa -> IA -> WhatsApp.
// El BOT ya reservó los números y actualizó Supabase antes de llegar aquí
// (ver bot/handlers/eventHandler.js). Esta función SOLO redacta y envía
// el mensaje de confirmación; nunca decide ni modifica el negocio.
const { construirContextoReserva } = require("./contextBuilder");
const { suggestReply } = require("./aiService");
const { sendMessage } = require("../../services/baileys/send");

async function responderReserva(ctx) {

    const reserva = ctx.reserva;

    // FASE 1: solo reserva exitosa con al menos un número reservado.
    if (!reserva || reserva.ok !== true) {
        return;
    }

    if (!reserva.reservados || reserva.reservados.length === 0) {
        return;
    }

    // Respuesta fija actual = fallback obligatorio si la IA falla o no está configurada.
    let texto = reserva.mensaje;

    try {

        const contexto = construirContextoReserva(ctx);

        const sugerencia = await suggestReply(contexto);

        if (sugerencia?.respuesta) {

            texto = sugerencia.respuesta;

        }

    }

    catch (error) {

        console.log("⚠️ Fallback a respuesta fija (error inesperado en IA):", error.message);

    }

    try {

        await sendMessage(ctx.chat.remoteJid, { text: texto });

        console.log("📤 Respuesta de reserva enviada al grupo:", ctx.chat.remoteJid);

    }

    catch (error) {

        console.log("❌ Error enviando respuesta de reserva:", error.message);

    }

}

module.exports = {
    responderReserva
};
