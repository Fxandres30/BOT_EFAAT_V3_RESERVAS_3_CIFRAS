const {
    default: makeWASocket,
    useMultiFileAuthState
} = require("@whiskeysockets/baileys");

const path = require("path");

const supabase = require("../../lib/supabase");

const sockets = new Map();

async function createSocket(sessionId) {

    const existente = sockets.get(sessionId);

    if (existente) {

        console.log("🟢 Socket ya existe:", sessionId);

        return existente;

    }

    const authFolder = path.join(

        __dirname,

        "../../auth",

        sessionId

    );

    const {

        state,

        saveCreds

    } = await useMultiFileAuthState(authFolder);

    const sock = makeWASocket({

        auth: state

    });

    const originalSendMessage =
    sock.sendMessage.bind(sock);

sock.sendMessage = async (
    jid,
    content,
    options
) => {

    try {

        // Mostrar "escribiendo..."
        await sock.sendPresenceUpdate(
            "composing",
            jid
        );

        // Obtener el texto
        const texto =
            content?.text || "";

        // Tiempo base
        let tiempo = 700;

// Simular velocidad de escritura
tiempo += texto.length * 45;

// Variación humana
tiempo += Math.floor(
    Math.random() * 1800
);

// Nunca menos de 1 segundo
tiempo = Math.max(
    tiempo,
    1000
);

// Nunca más de 8 segundos
tiempo = Math.min(
    tiempo,
    8000
);
        await new Promise(resolve =>
            setTimeout(resolve, tiempo)
        );

        // Dejar de escribir
        await sock.sendPresenceUpdate(
            "paused",
            jid
        );

    }

    catch (e) {

        console.log(
            "Error en presencia:",
            e.message
        );

    }

    return originalSendMessage(
        jid,
        content,
        options
    );

};

    sockets.set(

        sessionId,

        sock

    );

    sock.ev.on(

        "creds.update",

        saveCreds

    );

    return sock;

}

async function disconnectSocket(sessionId) {

    const sock = sockets.get(sessionId);

    if (!sock) {

        return false;

    }

    try {

        await sock.logout();

    }

    catch (err) {

        console.log(

            "ERROR AL CERRAR SESIÓN:",

            err

        );

    }

    sockets.delete(sessionId);

    await supabase

        .from("sesiones")

        .update({

            estado: "desconectado",

            telefono: null,

            qr: null

        })

        .eq("id", sessionId);

    return true;

}

function getSocket(sessionId) {

    return sockets.get(sessionId);

}

function hasSocket(sessionId) {

    return sockets.has(sessionId);

}

module.exports = {

    createSocket,

    disconnectSocket,

    getSocket,

    hasSocket,

    sockets

};