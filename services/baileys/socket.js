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