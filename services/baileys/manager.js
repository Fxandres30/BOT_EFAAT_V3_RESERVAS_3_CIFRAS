const EventEmitter = require("events");

const {
    createSocket,
    disconnectSocket,
    getSocket,
    sockets
} = require("./socket");

const registrarEstados = require("./estados");
const supabase = require("../../lib/supabase");

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

                await this.setActive(disponibles[0]);

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

    async setActive(sessionId) {

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

    // Actualizar memoria
    this.activeSession = sessionId;

    // Buscar el usuario dueño de la sesión
    const { data: sesion, error: errorSesion } = await supabase
        .from("sesiones")
        .select("usuario_id")
        .eq("id", sessionId)
        .single();

    if (errorSesion) {

        console.error("ERROR BUSCANDO SESIÓN:", errorSesion);

        return false;

    }

    // Desactivar todas las sesiones de ese usuario
    const r1 = await supabase
        .from("sesiones")
        .update({ activa: false })
        .eq("usuario_id", sesion.usuario_id);

    console.log("UPDATE FALSE:", r1);

    // Activar únicamente la seleccionada
    const r2 = await supabase
        .from("sesiones")
        .update({ activa: true })
        .eq("id", sessionId);

    console.log("UPDATE TRUE:", r2);

    console.log("⭐ Nueva sesión activa:", sessionId);

    this.emit("activeChanged", {
        sessionId,
        socket: this.get(sessionId)
    });

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