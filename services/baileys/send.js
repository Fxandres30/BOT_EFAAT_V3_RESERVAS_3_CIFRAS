const manager = require("./manager");

function esperar(ms) {

    return new Promise(resolve =>
        setTimeout(resolve, ms));

}

async function sendMessage(jid, message) {

    const sock = manager.getActiveSocket();

    if (!sock) {

        throw new Error("No hay una sesión activa.");

    }

    try {

        // Mostrar "escribiendo..."
        await sock.sendPresenceUpdate(
            "composing",
            jid
        );

        // Obtener el texto
        const texto = message.text || "";

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
        await sock.sendPresenceUpdate(
            "paused",
            jid
        );

        // Enviar mensaje
        return await sock.sendMessage(
            jid,
            message
        );

    }

    catch (error) {

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