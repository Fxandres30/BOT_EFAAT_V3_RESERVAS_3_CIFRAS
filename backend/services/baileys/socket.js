const {
    default: makeWASocket,
    useMultiFileAuthState
} = require("@whiskeysockets/baileys");

const {
    registerGroups
} = require("../../bot/events/groups");

const path = require("path");
const supabase = require("../../lib/supabase");

const sockets = new Map();

// Creaciones en vuelo por sessionId — garantiza "1 sessionId = máximo 1
// socket vivo" dentro del proceso. Si llegan varias llamadas a
// createSocket() para el MISMO sessionId mientras la primera todavía está
// esperando (Supabase, lectura de archivos de auth, makeWASocket), las
// demás reutilizan la MISMA promesa en vez de crear cada una su propio
// socket real con las mismas credenciales (eso era lo que producía
// conflict/replaced (440) contra WhatsApp: dos sockets reales autenticados
// con la misma identidad). Se limpia siempre (éxito o error) para permitir
// un intento posterior controlado.
const creando = new Map();

async function createSocket(sessionId) {

    if (sockets.has(sessionId)) {

        console.log("🟢 Socket ya existe");

        return { sock: sockets.get(sessionId), isNew: false };

    }

    const enVuelo = creando.get(sessionId);

    if (enVuelo) {

        console.log("⏳ Ya hay una creación en curso para esta sesión, reutilizando:", sessionId);

        const sock = await enVuelo;

        return { sock, isNew: false };

    }

    const promesa = crearSocketInterno(sessionId).finally(() => {

        creando.delete(sessionId);

    });

    creando.set(sessionId, promesa);

    const sock = await promesa;

    return { sock, isNew: true };

}

async function crearSocketInterno(sessionId) {

    console.log("================================");
    console.log("🚀 CREATE SOCKET");
    console.log("SESSION:", sessionId);
    console.log("================================");

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

    registerGroups(sock);

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