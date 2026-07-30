const {
    default: makeWASocket,
    useMultiFileAuthState
} = require("@whiskeysockets/baileys");

const path = require("path");
const supabase = require("../../lib/supabase");

const sockets = new Map();

async function createSocket(sessionId) {

    console.log("================================");
    console.log("🚀 CREATE SOCKET");
    console.log("SESSION:", sessionId);
    console.log("================================");

    const existente = sockets.get(sessionId);

    if (existente) {

        console.log("🟢 Socket ya existe");

        return existente;

    }

    const {
        data: session,
        error
    } = await supabase
        .from("sesiones")
        .select("*")
        .eq("id", sessionId)
        .single();

    if (error) {

        console.error("❌ Error obteniendo sesión");
        console.error(error);

        return null;

    }

    console.log("✅ Sesión encontrada");

    const authFolder = path.join(
        __dirname,
        "../../auth",
        sessionId
    );

    console.log("📂 AUTH:", authFolder);

    const {
        state,
        saveCreds
    } = await useMultiFileAuthState(authFolder);

    console.log("================================");
    console.log("AUTH");
    console.log("================================");

    console.log("REGISTERED:", state.creds.registered);
    console.log("ME:", state.creds.me);
    console.log("ACCOUNT:", state.creds.account);

    console.log("NOISE:", !!state.creds.noiseKey);
    console.log("IDENTITY:", !!state.creds.signedIdentityKey);
    console.log("SIGNED PREKEY:", !!state.creds.signedPreKey);

    console.log("================================");

    const sock = makeWASocket({

        auth: state

    });

    console.log("✅ SOCKET CREADO");

    console.log("sock.user:", sock.user);

    sock.context = {

        sessionId: session.id,
        usuarioId: session.usuario_id,
        telefono: session.telefono,
        nombreSesion: session.nombre,
        estado: session.estado

    };

    sock.ev.on("creds.update", (...args) => {

        console.log("💾 CREDS.UPDATE");

        saveCreds(...args);

    });

    sock.ev.on("connection.update", update => {

        console.log("================================");
        console.log("CONNECTION.UPDATE");
        console.log("================================");

        console.dir(update, {
            depth: null
        });

    });

    sock.ev.on("messages.upsert", () => {

        console.log("📨 MESSAGE");

    });

    sockets.set(sessionId, sock);

    return sock;

}

async function disconnectSocket(sessionId) {

    const sock = sockets.get(sessionId);

    if (!sock) {

        return false;

    }

    try {

        await sock.logout();

    } catch (err) {

        console.error("ERROR LOGOUT");
        console.error(err);

    }

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