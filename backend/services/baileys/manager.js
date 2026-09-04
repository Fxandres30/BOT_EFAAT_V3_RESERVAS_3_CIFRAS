const EventEmitter = require("events");

const {
    createSocket,
    disconnectSocket,
    getSocket,
    sockets
} = require("./socket");

const registrarEstados = require("./estados");
const supabase = require("../../lib/supabase");

// Señal inequívoca para "la fila de Supabase no existe" — se distingue del
// null que se devuelve para un error real de Supabase, así quien llama
// (baileysService.connect) puede reaccionar distinto en cada caso.
const SESSION_NOT_FOUND = "SESSION_NOT_FOUND";

// Utilidades de SOLO LECTURA para logs de trazabilidad (no afectan al
// algoritmo de failover ni a la selección de sesión).
const {
    identidadDesdeSocket,
    maskPhone
} = require("./identidadSesion");

class SessionManager extends EventEmitter {

    constructor() {

        super();

        this.sockets = sockets;
        this.activeSession = null;

        // Referencia al objeto socket que realmente está registrado ahora
        // mismo como listener del BOT (ver evaluarConexion) — separado de
        // this.activeSession (que solo guarda el sessionId) para poder
        // detectar cuándo la MISMA sesión reconecta con una instancia de
        // socket nueva (bug corregido: antes, en ese caso, nunca se
        // volvía a emitir "activeChanged" y el listener quedaba colgado
        // del socket viejo/muerto para siempre).
        this.activeSocket = null;

    }

    async start(sessionId) {

    if (this.has(sessionId)) {

        console.log("🟢 Sesión ya iniciada:", sessionId);

        return this.get(sessionId);

    }

    console.log("🚀 Iniciando sesión:", sessionId);

    const { data: sesion, error } = await supabase
    .from("sesiones")
    .select("estado")
    .eq("id", sessionId)
    .maybeSingle();

if (error) {

    console.error("❌ Error obteniendo sesión:", error.message);

    return null;

}

if (!sesion) {

    console.log(`⚠️ La sesión ${sessionId} ya no existe.`);

    return SESSION_NOT_FOUND;

}

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

            const candidata = await this.selectFailoverSession({ excluir: sessionId });

            if (candidata) {

                const idNueva = identidadDesdeSocket(this.get(candidata));

                console.log("🔄 [SESSION FAILOVER]", {
                    sesionAnterior: sessionId,
                    motivo: "parada manual",
                    nuevaSesionActivaId: candidata,
                    nuevaSesionActiva: idNueva.nombre,
                    telefono: maskPhone(idNueva.telefono)
                });

                await this.setActive(candidata);

            } else {

                console.log("🔄 [SESSION FAILOVER]", {
                    sesionAnterior: sessionId,
                    motivo: "parada manual",
                    nuevaSesionActivaId: null,
                    nuevaSesionActiva: "(ninguna — BOT sin sesión activa)"
                });

                console.log("[FAILOVER] sin sesiones disponibles tras detener", sessionId);

                this.emit("activeLost");

            }

        }

        return true;

    }

    has(sessionId) {

        return this.sockets.has(sessionId);

    }

    isConnected(sessionId) {

        return this.has(sessionId);

    }

    get(sessionId) {

        return getSocket(sessionId);

    }

    getAll() {

        return [...this.sockets.keys()];

    }

    getConnectedSessions() {

        return this.getAll();

    }

    // preferida:true SOLO cuando el cambio viene de una selección manual real
    // del usuario (ver bot/controllers/sessionsController.js). El failover
    // automático nunca pasa preferida:true, para no cambiar la preferencia
    // del usuario sin que él lo haya pedido.
    async setActive(sessionId, { preferida = false } = {}) {

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

        // Mantener alineada la referencia de socket, por si esta sesión
        // reconectó con una instancia nueva entre medio (el camino normal
        // para ese caso es evaluarConexion; esto es solo un resguardo
        // para no dejar activeSocket desactualizado si setActive se
        // llama directamente).
        this.activeSocket = this.get(sessionId);

        if (preferida) {
            await this._marcarPreferida(sessionId);
        }

        return true;

    }

    // Actualizar memoria
    this.activeSession = sessionId;
    this.activeSocket = this.get(sessionId);

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
    console.log("[SESSION]", { preferida: preferida ? sessionId : "(sin cambio)", activa: sessionId });

    if (preferida) {
        await this._marcarPreferida(sessionId, sesion.usuario_id);
    }

    this.emit("activeChanged", {
        sessionId,
        socket: this.get(sessionId)
    });

    return true;

}

    // Persiste la preferencia del usuario reutilizando la columna existente
    // "principal" (auditada en Fase 5.1: no la lee ni la escribe ningún otro
    // código del backend, así que reutilizarla no cambia ningún
    // comportamiento existente).
    async _marcarPreferida(sessionId, usuarioId) {

        try {

            let uid = usuarioId;

            if (!uid) {

                const { data } = await supabase
                    .from("sesiones")
                    .select("usuario_id")
                    .eq("id", sessionId)
                    .single();

                uid = data?.usuario_id;

            }

            if (!uid) return;

            await supabase
                .from("sesiones")
                .update({ principal: false })
                .eq("usuario_id", uid);

            await supabase
                .from("sesiones")
                .update({ principal: true })
                .eq("id", sessionId);

            console.log("[SESSION] preferida:", sessionId);

        } catch (err) {

            console.error("❌ Error marcando sesión preferida:", err.message);

        }

    }

    // Marca una sesión como preferida sin exigir que esté conectada (a
    // diferencia de setActive). Uso: botón "Hacer principal" del panel
    // sobre una sesión desconectada. Nunca toca activeSession ni el
    // listener del BOT — solo la preferencia persistida.
    async marcarPreferidaManual(sessionId) {

        const { data, error } = await supabase
            .from("sesiones")
            .select("id")
            .eq("id", sessionId)
            .maybeSingle();

        if (error || !data) {
            return false;
        }

        await this._marcarPreferida(sessionId);

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

    // ============================================================
    // FASE 5.1 — decisión central de conexión y failover
    // ============================================================

    // Llamado cuando CUALQUIER sesión termina de conectar/reconectar.
    // Decide si debe convertirse en la sesión activa del BOT o si
    // simplemente queda "disponible" sin robar el listener actual.
    async evaluarConexion(sessionId) {

        const socketDeEstaConexion = this.get(sessionId);

        const activaValida =
            !!this.activeSession && this.isConnected(this.activeSession);

        console.log("[SESSION]", {
            evento: "conexion",
            sesionConectada: sessionId,
            activaActual: this.activeSession,
            activaValida
        });

        // B: ya es la sesión activa Y sigue siendo el mismo socket que ya
        // tenía el listener del BOT -> nada que decidir aquí.
        //
        // BUG CORREGIDO: si el socket es DISTINTO (misma sesión, pero
        // reconectada con una instancia de socket nueva — típico tras un
        // "restartRequired" o una reconexión temporal), antes esta rama
        // cortaba en seco y "activeChanged" nunca se volvía a emitir. El
        // listener (bot/index.js) se quedaba escuchando el socket viejo
        // y muerto para siempre, aunque activeSession y Supabase
        // siguieran diciendo "conectado". Aquí se detecta ese caso y se
        // re-emite "activeChanged" para mover el listener y el worker al
        // socket nuevo — sin tocar Supabase ni la preferencia (no es un
        // cambio real de sesión activa, solo de instancia de socket).
        if (activaValida && this.activeSession === sessionId) {

            if (this.activeSocket !== socketDeEstaConexion) {

                console.log("[SESSION] mismo sessionId activo, socket reemplazado -> re-emitiendo activeChanged:", sessionId);

                this.activeSocket = socketDeEstaConexion;

                this.emit("activeChanged", {
                    sessionId,
                    socket: socketDeEstaConexion
                });

            }

            return;

        }

        // A / C: no hay ninguna sesión activa válida -> esta sesión toma el control
        // (cubre tanto el caso general como el caso "es la preferida" cuando la
        // activa actual dejó de estar disponible).
        if (!activaValida) {

            console.log("[SESSION] sin sesión activa válida -> promoviendo:", sessionId);

            await this.setActive(sessionId);

            return;

        }

        // D: ya existe una activa saludable y esta es otra sesión -> no la reemplaza.
        console.log("[SESSION] sesión secundaria conectada, se mantiene la activa actual:", this.activeSession);

    }

    // Elige la mejor candidata para failover entre las sesiones REALMENTE
    // conectadas (excluyendo la que acaba de caer). Orden: preferida primero,
    // si no, cualquier otra conectada disponible.
    async selectFailoverSession({ excluir } = {}) {

        const conectadas = this.getConnectedSessions()
            .filter(id => id !== excluir);

        if (conectadas.length === 0) {
            return null;
        }

        try {

            const { data } = await supabase
                .from("sesiones")
                .select("id")
                .in("id", conectadas)
                .eq("principal", true)
                .maybeSingle();

            if (data?.id) {
                return data.id;
            }

        } catch (err) {

            console.error("❌ Error buscando sesión preferida para failover:", err.message);

        }

        return conectadas[0];

    }

    // Llamado cuando una sesión se desconecta de forma DEFINITIVA (no en los
    // casos de reintento automático de la misma sesión). Si esa sesión era
    // la activa del BOT, dispara el failover; si no lo era, no hace nada.
    async manejarDesconexionActiva(sessionIdCaida) {

        if (this.activeSession !== sessionIdCaida) {
            return;
        }

        console.log("[FAILOVER]", {
            sesionCaida: sessionIdCaida,
            sesionAnterior: this.activeSession
        });

        this.activeSession = null;

        const candidata = await this.selectFailoverSession({ excluir: sessionIdCaida });

        if (!candidata) {

            console.log("[FAILOVER]", {
                sesionCaida: sessionIdCaida,
                nuevaSesion: null,
                motivo: "sin sesiones disponibles"
            });

            console.log("🔄 [SESSION FAILOVER]", {
                sesionAnterior: sessionIdCaida,
                motivo: "desconexión definitiva",
                nuevaSesionActivaId: null,
                nuevaSesionActiva: "(ninguna — BOT sin sesión activa)"
            });

            this.emit("activeLost");

            return;

        }

        console.log("[FAILOVER]", {
            sesionCaida: sessionIdCaida,
            nuevaSesion: candidata
        });

        const idNueva = identidadDesdeSocket(this.get(candidata));

        console.log("🔄 [SESSION FAILOVER]", {
            sesionAnterior: sessionIdCaida,
            motivo: "desconexión definitiva",
            nuevaSesionActivaId: candidata,
            nuevaSesionActiva: idNueva.nombre,
            telefono: maskPhone(idNueva.telefono)
        });

        await this.setActive(candidata);

    }

}

const manager = new SessionManager();

// Constante pública para que los llamadores (p.ej. baileysService) puedan
// comparar el resultado de start() sin depender de un string mágico duplicado.
manager.SESSION_NOT_FOUND = SESSION_NOT_FOUND;

module.exports = manager;