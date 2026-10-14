const manager = require("../services/baileys/manager");

// Fase 1 — regla única de propiedad de sesión (ver propiedadSesion.js):
// listeners de grupos, cola de IQ de grupo, workerEventos y scheduler
// solo actúan con el socket vigente, open, de la sesión activa.
const propiedadSesion = require("../services/baileys/propiedadSesion");

// Utilidades de SOLO LECTURA para el log de sesión activa (Fase de
// observabilidad). No intervienen en la selección de sesión.
const {
    identidadDesdeSocket,
    maskPhone
} = require("../services/baileys/identidadSesion");

const {
    registerMessages,
    unregisterMessages,
    socketConListener
} = require("./events/messages.upsert");

// Señal de salud real para el panel y vigilante de recuperación.
const salud = require("../services/baileys/salud");

// FASE 2 (IdentitySync) — escaneo EN VIVO de identidades sobre cada
// mensaje, en un listener TOTALMENTE INDEPENDIENTE del de arriba (ver
// cabecera de identitySync.upsert.js: aislamiento — un fallo ahí nunca
// afecta a registerMessages/dispatcher/reservas — y no bloqueante —
// fire-and-forget, sin await en el camino de negocio).
const {
    registerIdentitySync,
    unregisterIdentitySync
} = require("./events/identitySync.upsert");

const {
    iniciarWorkerEventos,
    detenerWorkerEventos
} = require("./funciones/eventos/lifecycle/iniciarWorkerEventos");

// CORRECCIÓN (Fase Producción Real): el Scheduler del Automation Engine
// (tabla inicial/recordatorios/actualización/cierre — automation/scheduler.js)
// ya existía completo y probado, pero nada en producción llamaba a
// start()/stop() — su propio comentario de cabecera lo documentaba
// explícitamente. Se arranca aquí con el MISMO patrón exacto que
// iniciarWorkerEventos/detenerWorkerEventos (mismo sock, mismo criterio de
// una sesión = un intervalo, sin crear un segundo scheduler).
const scheduler = require("../automation/scheduler");

// Control de inactividad (15 días sin compra confirmada). Por defecto en
// SIMULACIÓN: nunca expulsa sin INACTIVIDAD_MODO=real +
// INACTIVIDAD_CONFIRMAR_EXPULSIONES=SI (ver configInactividad.js).
const {
    iniciarWorkerInactividad,
    detenerWorkerInactividad
} = require("./funciones/inactividad/workerInactividad");

// Sorteos programados desde el panel: publicación, recordatorios, aviso de
// cierre y vencimientos (backend/sorteos/publicador.js).
const {
    iniciarPublicadorSorteos,
    detenerPublicadorSorteos
} = require("../sorteos/publicador");

// Escáner de identidades: escaneo inicial completo al conectar/reconectar
// (ver escanerIdentidadesLifecycle.js). Los escaneos incrementales por
// apertura de grupo se disparan aparte, desde detectarEvento.js /
// workerEventos.js, justo después de confirmar que abrirGrupo() tuvo éxito.
const {
    iniciarEscanerIdentidades,
    detenerEscanerIdentidades
} = require("./funciones/usuarios/escanerIdentidadesLifecycle");

let socketActual = null;
let sesionActual = null;
let iniciado = false;
let vigilante = null;
let sospechasSeguidas = 0;

const VIGILANTE_MS = 30000;

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
        unregisterIdentitySync(anterior);
        detenerWorkerEventos(anterior);
        detenerEscanerIdentidades(anterior);
        scheduler.stop(anterior);
        detenerWorkerInactividad(anterior);
        detenerPublicadorSorteos(anterior);

    }

    socketActual = socket;
    sesionActual = sessionId;

    console.log("[BOT]", { listener: "registrado", anterior: anterior || "(ninguno)", nuevo: sessionId });

    registerMessages(socket, sessionId);

    registerIdentitySync(socket, sessionId);

    iniciarWorkerEventos(socket);

    scheduler.start(socket);

    iniciarWorkerInactividad(socket);

    iniciarPublicadorSorteos(socket);

    console.log("[WORKER] iniciado:", sessionId);

    // No bloqueante: el escaneo inicial de todos los grupos corre en
    // segundo plano y nunca retrasa el registro de mensajes/worker de
    // arriba (ya hechos).
    iniciarEscanerIdentidades(sessionId, socket);

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
    unregisterIdentitySync(sesionActual);
    detenerWorkerEventos(sesionActual);
    detenerEscanerIdentidades(sesionActual);
    scheduler.stop(sesionActual);
    detenerWorkerInactividad(sesionActual);
    detenerPublicadorSorteos(sesionActual);

    console.log("[WORKER] detenido:", sesionActual);

    socketActual = null;
    sesionActual = null;

}

// ─────────────────────────────────────────────────────────────
// VIGILANTE — recuperación automática segura.
//
// Síntoma real en producción: la sesión activa figura "conectada" pero el
// bot deja de leer mensajes hasta reconectar a mano. Causa: el socket
// activo cambia (o vuelve a open) sin que el listener/worker se registren
// sobre él. Cada 30 s se comprueba que el socket VIGENTE, open, de la
// sesión activa sea el que tiene el listener de negocio. Si dos revisiones
// seguidas lo encuentran desalineado, se vuelve a ejecutar conectar() sobre
// ESE socket: quita los listeners viejos antes de poner los nuevos (nunca
// duplica), no abre sockets, no toca credenciales ni el lease, y no hace
// nada si no hay un socket activo open (la reconexión es del manager).
// ─────────────────────────────────────────────────────────────
function revisarSalud() {

    const sessionId = manager.getActiveSession();
    const socket = manager.getActiveSocket();

    if (!socket || !sessionId || !manager.esSocketVigenteActivo(socket)) {
        sospechasSeguidas = 0;
        return null;
    }

    const alineado = sesionActual === sessionId
        && socketActual === socket
        && socketConListener(sessionId) === socket;

    if (alineado) {
        sospechasSeguidas = 0;
        return null;
    }

    sospechasSeguidas++;

    // La primera vez puede ser una transición en curso (activeChanged a
    // punto de llegar): se espera a la siguiente revisión.
    if (sospechasSeguidas < 2) return "sospecha";

    sospechasSeguidas = 0;

    const causa = socketConListener(sessionId) !== socket
        ? "socket activo sin listener de mensajes"
        : "el bot apuntaba a otro socket";

    console.log("🩺 [SALUD] recuperación automática:", { sessionId, causa });

    salud.marcarRecuperacion(sessionId, causa);

    // Fuerza el re-registro completo aunque conectar() crea que ya está
    // escuchando este mismo socket.
    if (socketActual === socket) socketActual = null;

    conectar(socket, sessionId);

    return "recuperado";

}

function iniciarVigilante() {

    if (vigilante) return;

    vigilante = setInterval(() => {
        try { revisarSalud(); }
        catch (err) { console.error("❌ [SALUD] vigilante:", err?.message); }
    }, VIGILANTE_MS);

    vigilante.unref?.();

}

function iniciarBot() {

    if (iniciado) {
        return;
    }

    console.log("📡 Registrando activeChanged / activeLost / activeSocketClosed");

    propiedadSesion.configurar(sock => manager.esSocketVigenteActivo(sock));

    manager.on("activeChanged", ({ socket, sessionId }) => {

        console.log("⭐ activeChanged recibido:", sessionId);

        conectar(socket, sessionId);

    });

    manager.on("activeLost", () => {

        console.log("⚠️ activeLost recibido");

        detenerBot();

    });

    // Fase 1: el socket activo se cerró (reconexión temporal, restart
    // requerido, logout...). Se detiene YA todo lo que dependía de él; si
    // la misma sesión vuelve a open, evaluarConexion re-emite
    // activeChanged con el socket nuevo y conectar() lo registra de cero.
    manager.on("activeSocketClosed", ({ sessionId, socket }) => {

        if (socket !== socketActual) {
            return;
        }

        console.log("⚠️ activeSocketClosed recibido:", sessionId);

        detenerBot();

    });

    iniciado = true;

    iniciarVigilante();

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

// Para pruebas y para la ruta de salud.
module.exports.revisarSalud = revisarSalud;
module.exports.estadoBot = () => ({ sesionActual, socketActual });
