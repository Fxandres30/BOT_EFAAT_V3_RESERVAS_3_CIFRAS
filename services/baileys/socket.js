const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    Browsers
} = require("@whiskeysockets/baileys");

const path = require("path");
const QRCode = require("qrcode");

const supabase = require("../../lib/supabase");

const sockets = new Map();

async function createSocket(sessionId) {

     if (sockets.has(sessionId)) {
        return sockets.get(sessionId);
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

    sockets.set(sessionId, sock);

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {

        console.log("UPDATE:", update);

        const {
            connection,
            qr,
            lastDisconnect
        } = update;

        // ==========================
        // QR
        // ==========================
        if (qr) {

            console.log("QR RECIBIDO");

            try {

                const qrBase64 = await QRCode.toDataURL(qr);

                const { error } = await supabase
                    .from("sesiones")
                    .update({
                        qr: qrBase64,
                        estado: "esperando_qr"
                    })
                    .eq("id", sessionId);

                console.log("QR ERROR:", error);

            } catch (err) {

                console.log("ERROR GENERANDO QR:", err);

            }

        }

        // ==========================
        // CONECTADO
        // ==========================
        if (connection === "open") {

            console.log("CONECTADO");

            const numero = sock.user?.id?.split(":")[0] || null;

            const { error } = await supabase
                .from("sesiones")
                .update({
                    telefono: numero,
                    estado: "conectado",
                    qr: null
                })
                .eq("id", sessionId);

            console.log("OPEN ERROR:", error);

        }

        // ==========================
        // DESCONECTADO
        // ==========================
        if (connection === "close") {

    const statusCode =
        lastDisconnect?.error?.output?.statusCode;

    console.log("STATUS:", statusCode);

    if (statusCode === DisconnectReason.restartRequired) {

        console.log("REINICIANDO SOCKET...");

        sockets.delete(sessionId);

        return createSocket(sessionId);

    }

    if (statusCode === DisconnectReason.loggedOut) {

        console.log("SESION CERRADA");

        await supabase
            .from("sesiones")
            .update({

                estado: "desconectado",
                qr: null

            })
            .eq("id", sessionId);

        sockets.delete(sessionId);

        return;

    }

    console.log("RECONEXION...");

    sockets.delete(sessionId);

    return createSocket(sessionId);

}

    });

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

        console.log("ERROR AL CERRAR SESIÓN:", err);

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

module.exports = {
    createSocket,
    disconnectSocket,
    sockets
};