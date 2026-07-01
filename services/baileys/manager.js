const EventEmitter = require("events");

const {
    createSocket,
    disconnectSocket,
    getSocket,
    sockets
} = require("./socket");

const registrarEstados = require("./estados");

class SessionManager extends EventEmitter {

    constructor() {

        super();

        this.sockets = sockets;
        this.activeSession = null;

    }

    async start(sessionId) {

    if (this.has(sessionId)) {

        console.log("🟢 Sesión ya iniciada:", sessionId);

        return this.get(sessionId);

    }

    console.log("🚀 Iniciando sesión:", sessionId);

    const socket = await createSocket(sessionId);

    registrarEstados(

        socket,

        sessionId,

        {

            manager: this,

            sockets: this.sockets

        }

    );

    return socket;

}

    async stop(sessionId) {

        console.log("🔴 Deteniendo sesión:", sessionId);

        await disconnectSocket(sessionId);

        if (this.activeSession === sessionId) {

            this.activeSession = null;

            const disponibles = this.getAll();

            if (disponibles.length > 0) {

                this.setActive(disponibles[0]);

            }

        }

        return true;

    }

    has(sessionId) {

        return this.sockets.has(sessionId);

    }

    get(sessionId) {

        return getSocket(sessionId);

    }

    getAll() {

        return [...this.sockets.keys()];

    }

    setActive(sessionId) {

        console.log("========== SET ACTIVE ==========");
        console.log("Session recibida:", sessionId);
        console.log("Sockets conectados:", this.getAll());
        console.log("================================");

        if (!this.has(sessionId)) {

            console.log("❌ La sesión no está conectada.");

            return false;

        }

        if (this.activeSession === sessionId) {

            console.log("ℹ️ Ya era la sesión activa.");

            return true;

        }

        this.activeSession = sessionId;

        console.log("⭐ Nueva sesión activa:", sessionId);

        this.emit(

            "activeChanged",

            {

                sessionId,

                socket: this.get(sessionId)

            }

        );

        return true;

    }

    getActiveSession() {

        return this.activeSession;

    }

    getActiveSocket() {

        if (!this.activeSession) {

            return null;

        }

        return this.get(this.activeSession);

    }

    isActive(sessionId) {

        return this.activeSession === sessionId;

    }

}

module.exports = new SessionManager();