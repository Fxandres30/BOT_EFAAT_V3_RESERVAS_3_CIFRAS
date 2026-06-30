const supabase = require("../../lib/supabase");

const timers = new Map();

function iniciarTimeout(sessionId, sock, sockets) {

    // Ya existe un contador para esta sesión
    if (timers.has(sessionId)) {
        return;
    }

    const timer = setTimeout(async () => {

        console.log("⌛ QR expiró:", sessionId);

        try {

            await sock.logout();

        } catch (err) {}

        sockets.delete(sessionId);

        await supabase
            .from("sesiones")
            .update({

                estado: "desconectado",
                qr: null,
                telefono: null

            })
            .eq("id", sessionId);

        timers.delete(sessionId);

    }, 1000 * 60 * 2); // 2 minutos

    timers.set(sessionId, timer);

}

function cancelarTimeout(sessionId) {

    const timer = timers.get(sessionId);

    if (!timer)
        return;

    clearTimeout(timer);

    timers.delete(sessionId);

}

module.exports = {

    iniciarTimeout,
    cancelarTimeout

};