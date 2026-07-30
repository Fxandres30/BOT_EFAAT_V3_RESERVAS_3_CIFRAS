const {
    default: makeWASocket,
    useMultiFileAuthState
} = require("@whiskeysockets/baileys");

const P = require("pino");

async function iniciar() {

    const { state, saveCreds } =
        await useMultiFileAuthState("./auth-test");

    const sock = makeWASocket({

        auth: state,

        logger: P({
            level: "trace"
        }),

        printQRInTerminal: true

    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", (update) => {

        console.log("================================");
        console.dir(update, { depth: null });
        console.log("================================");

    });

}

iniciar().catch(console.error);