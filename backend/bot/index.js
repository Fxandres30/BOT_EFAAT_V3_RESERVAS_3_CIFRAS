const manager = require("../services/baileys/manager");

// Utilidades de SOLO LECTURA para el log de sesión activa (Fase de
// observabilidad). No intervienen en la selección de sesión.
const {
    identidadDesdeSocket,
    maskPhone
} = require("../services/baileys/identidadSesion");

const {
    registerMessages,
    unregisterMessages
} = require("./events/messages.upsert");

const {
    iniciarWorkerEventos,
    detenerWorkerEventos
} = require("./funciones/eventos/lifecycle/iniciarWorkerEventos");

let socketActual = null;
let sesionActual = null;
let iniciado = false;

// Único punto donde el BOT cambia de sesión: siempre a través de
// manager "activeChanged" (Fase 5.1). Nunca se llama directamente
// desde conectado.js para cualquier sesión que conecte.
function conectar(socket, sessionId) {

    console.log("================================");
    console.log("🔄 CONECTAR");
    console.log("Session nueva :", sessionId);
    console.log("Session actual:", sesionActual);
    console.log("================================");

    if (!socket || !sessionId) {

        console.log("❌ Socket o sessionId inválidos");

        return;

    }

    // BUG CORREGIDO: antes esta comparación era solo por sessionId. Si la
    // MISMA sesión reconectaba con una instancia de socket nueva (p. ej.
    // tras un "restartRequired" o una reconexión temporal), este `return`
    // se ejecutaba igual y el listener se quedaba colgado del socket
    // viejo/muerto para siempre — el BOT dejaba de recibir mensajes de
    // esa sesión aunque manager.activeSession y Supabase siguieran
    // diciendo "conectado". Ahora también exige que sea el MISMO objeto
    // socket para saltarse el re-registro.
    if (sesionActual === sessionId && socketActual === socket) {

        console.log("ℹ️ Ya estaba escuchando esta misma sesión con este mismo socket.");

        return;

    }

    const anterior = sesionActual;

    if (anterior) {

        console.log("[WORKER] detenido:", anterior);
        console.log("[BOT]", { listener: "eliminado", sesion: anterior });

        unregisterMessages(anterior);
        detenerWorkerEventos(anterior);

    }

    socketActual = socket;
    sesionActual = sessionId;

    console.log("[BOT]", { listener: "registrado", anterior: anterior || "(ninguno)", nuevo: sessionId });

    registerMessages(socket, sessionId);

    iniciarWorkerEventos(socket);

    console.log("[WORKER] iniciado:", sessionId);

    // ─────────────────────────────────────────────────────────────
    // TRAZABILIDAD — identidad de la sesión que el BOT está usando
    // AHORA (listener + worker ya apuntan a este socket). Solo log.
    // ─────────────────────────────────────────────────────────────
    const idActiva = identidadDesdeSocket(socket);

    console.log("🤖 [SESSION ACTIVE]", {
        sessionId: idActiva.sessionId,
        sesion: idActiva.nombre,
        telefono: maskPhone(idActiva.telefono),
        estado: idActiva.estado,
        sesionAnterior: anterior || "(ninguna)",
        listener: "registrado",
        workerEventos: "iniciado"
    });

}

// Se dispara cuando el manager avisa que ya no hay ninguna sesión activa
// disponible (failover sin candidatas). Detiene listener y worker sin
// dejar nada corriendo para una sesión muerta.
function detenerBot() {

    if (!sesionActual) {
        return;
    }

    console.log("[BOT]", { listener: "detenido (sin sesión activa disponible)", sesion: sesionActual });

    unregisterMessages(sesionActual);
    detenerWorkerEventos(sesionActual);

    console.log("[WORKER] detenido:", sesionActual);

    socketActual = null;
    sesionActual = null;

}

function iniciarBot() {

    if (iniciado) {
        return;
    }

    console.log("📡 Registrando activeChanged / activeLost");

    manager.on("activeChanged", ({ socket, sessionId }) => {

        console.log("⭐ activeChanged recibido:", sessionId);

        conectar(socket, sessionId);

    });

    manager.on("activeLost", () => {

        console.log("⚠️ activeLost recibido");

        detenerBot();

    });

    iniciado = true;

    // Por si al momento de suscribirse ya existía una sesión activa
    // (orden de arranque del servidor).
    const socket = manager.getActiveSocket();
    const sessionId = manager.getActiveSession();

    if (socket && sessionId) {

        console.log("➡️ Sesión activa ya existente al iniciar:", sessionId);

        conectar(socket, sessionId);

    }

}

module.exports = iniciarBot;
