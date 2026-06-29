const { createSocket, disconnectSocket, sockets } = require("./socket");

class SessionManager {

    constructor() {

        this.sockets = sockets;

    }

    async start(sessionId) {

        if (this.sockets.has(sessionId)) {

            console.log("🟢 Sesión ya iniciada:", sessionId);

            return this.sockets.get(sessionId);

        }

        console.log("🚀 Iniciando sesión:", sessionId);

        return manager.start(sessionId);

    }

    async stop(sessionId) {

        console.log("🔴 Deteniendo sesión:", sessionId);

        return manager.stop(sessionId);

    }

    has(sessionId) {

        return this.sockets.has(sessionId);

    }

    get(sessionId) {

        return this.sockets.get(sessionId);

    }

    getAll() {

        return [...this.sockets.keys()];

    }

}

module.exports = new SessionManager();