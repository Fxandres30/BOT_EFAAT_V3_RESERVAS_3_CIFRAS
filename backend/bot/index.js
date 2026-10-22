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

// MULTISESIÓN (2026-10-21): una sesión registrada POR CLIENTE, todas a la
// vez. sessionId -> { socket, usuarioId }. Registrar o detener una sesión
// nunca toca las de otros clientes; un cambio de sesión del MISMO cliente
// (A -> B) detiene A antes de registrar B.
const registradas = new Map();
const sospechas = new Map(); // sessionId -> revisiones desalineadas seguidas
let iniciado = false;
let vigilante = null;

const VIGILANTE_MS = 30000;

// Quita TODO lo de una sesión (listeners, workers, scheduler, escáner).
function detenerSesion(sessionId, motivo) {

    if (!registradas.has(sessionId)) return;

    console.log("[BOT]", { listener: "eliminado", sesion: sessionId, motivo });

    unregisterMessages(sessionId);
    unregisterIdentitySync(sessionId);
    detenerWorkerEventos(sessionId);
    detenerEscanerIdentidades(sessionId);
    scheduler.stop(sessionId);
    detenerWorkerInactividad(sessionId);
    detenerPublicadorSorteos(sessionId);

    registradas.delete(sessionId);
    sospechas.delete(sessionId);

    console.log("[WORKER] detenido:", sessionId);

}

// Registra listeners y workers de UNA sesión sobre SU socket. Solo llega
// aquí a través de manager "activeChanged" (activa de su cliente) o del
// vigilante. Sin dueño validado (sock.context.usuarioId, de la fila de
// sesiones) no se registra nada.
function conectar(socket, sessionId) {

    console.log("================================");
    console.log("🔄 CONECTAR");
    console.log("Session:", sessionId);
    console.log("Sesiones registradas:", registradas.size);
    console.log("================================");

    if (!socket || !sessionId) {

        console.log("❌ Socket o sessionId inválidos");

        return;

    }

    const usuarioId = socket.context?.usuarioId || null;

    if (!usuarioId) {

        console.error("❌ [BOT] sesión sin dueño (usuario_id): no se registra nada:", sessionId);

        detenerSesion(sessionId, "sin dueño");

        return;

    }

    // Misma sesión con el MISMO socket: nada que hacer. Con un socket
    // nuevo (reconexión, restartRequired) se re-registra de cero.
    if (registradas.get(sessionId)?.socket === socket) {

        console.log("ℹ️ Ya estaba escuchando esta misma sesión con este mismo socket.");

        return;

    }

    // Una sola sesión procesa por cliente: la anterior del MISMO cliente
    // se detiene. Las de otros clientes siguen intactas.
    for (const [id, r] of [...registradas]) {
        if (id !== sessionId && r.usuarioId === usuarioId) detenerSesion(id, "cambio de sesión del mismo cliente");
    }

    detenerSesion(sessionId, "socket reemplazado");

    registradas.set(sessionId, { socket, usuarioId });

    console.log("[BOT]", { listener: "registrado", sesion: sessionId, sesionesActivas: registradas.size });

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
    // TRAZABILIDAD — identidad de la sesión registrada. Solo log.
    // ─────────────────────────────────────────────────────────────
    const idActiva = identidadDesdeSocket(socket);

    console.log("🤖 [SESSION ACTIVE]", {
        sessionId: idActiva.sessionId,
        sesion: idActiva.nombre,
        telefono: maskPhone(idActiva.telefono),
        estado: idActiva.estado,
        listener: "registrado",
        workerEventos: "iniciado"
    });

}

// Detiene todas las sesiones registradas (compatibilidad: un "activeLost"
// sin datos de sesión).
function detenerBot() {

    for (const sessionId of [...registradas.keys()]) detenerSesion(sessionId, "sin sesión activa disponible");

}

// ─────────────────────────────────────────────────────────────
// VIGILANTE — recuperación automática segura, POR SESIÓN.
//
// Síntoma real en producción: la sesión activa figura "conectada" pero el
// bot deja de leer mensajes hasta reconectar a mano. Causa: el socket
// activo cambia (o vuelve a open) sin que el listener/worker se registren
// sobre él. Cada 30 s, para CADA cliente con sesión activa, se comprueba que
// su socket VIGENTE, open, sea el que tiene el listener de negocio. Si dos
// revisiones seguidas lo encuentran desalineado, se vuelve a ejecutar
// conectar() sobre ESE socket (nunca duplica: quita antes lo viejo). Además
// detiene lo registrado para una sesión que ya no es la activa de su
// cliente (workers huérfanos). No abre sockets, no toca credenciales ni el
// lease. Devuelve el resultado más grave: "recuperado" | "sospecha" | null.
// ─────────────────────────────────────────────────────────────
function revisarSalud() {

    let resultado = null;
    const vigentes = new Set();

    for (const { usuarioId, sessionId } of manager.getSesionesActivas()) {

        const socket = manager.getSocketActivoDe(usuarioId);

        // Reconectando (sin socket open): no se toca nada; lo suyo se
        // conserva hasta que el manager decida.
        if (!socket || !manager.esSocketVigenteActivo(socket)) {
            sospechas.delete(sessionId);
            if (registradas.has(sessionId)) vigentes.add(sessionId);
            continue;
        }

        vigentes.add(sessionId);

        const alineado = registradas.get(sessionId)?.socket === socket
            && socketConListener(sessionId) === socket;

        if (alineado) {
            sospechas.delete(sessionId);
            continue;
        }

        const n = (sospechas.get(sessionId) || 0) + 1;

        // La primera vez puede ser una transición en curso (activeChanged a
        // punto de llegar): se espera a la siguiente revisión.
        if (n < 2) {
            sospechas.set(sessionId, n);
            if (!resultado) resultado = "sospecha";
            continue;
        }

        sospechas.delete(sessionId);

        const causa = socketConListener(sessionId) !== socket
            ? "socket activo sin listener de mensajes"
            : "el bot apuntaba a otro socket";

        console.log("🩺 [SALUD] recuperación automática:", { sessionId, causa });

        salud.marcarRecuperacion(sessionId, causa);

        // Fuerza el re-registro completo aunque conectar() crea que ya está
        // escuchando este mismo socket.
        detenerSesion(sessionId, "recuperación del vigilante");

        conectar(socket, sessionId);

        resultado = "recuperado";

    }

    // Registradas que ya no son la activa de su cliente: huérfanas.
    for (const sessionId of [...registradas.keys()]) {
        if (!vigentes.has(sessionId)) detenerSesion(sessionId, "ya no es la sesión activa de su cliente");
    }

    return resultado;

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

    // Solo la sesión indicada (o, sin datos, todas: compatibilidad).
    manager.on("activeLost", (datos) => {

        console.log("⚠️ activeLost recibido:", datos?.sessionId || "(todas)");

        if (datos?.sessionId) detenerSesion(datos.sessionId, "sesión activa perdida");
        else detenerBot();

    });

    // Fase 1: el socket activo de un cliente se cerró (reconexión temporal,
    // restart requerido, logout...). Se detiene YA lo de esa sesión; si
    // vuelve a open, evaluarConexion re-emite activeChanged con el socket
    // nuevo y conectar() lo registra de cero.
    manager.on("activeSocketClosed", ({ sessionId, socket }) => {

        if (registradas.get(sessionId)?.socket !== socket) {
            return;
        }

        console.log("⚠️ activeSocketClosed recibido:", sessionId);

        detenerSesion(sessionId, "socket cerrado");

    });

    iniciado = true;

    iniciarVigilante();

    // Por si al momento de suscribirse ya existían sesiones activas
    // (orden de arranque del servidor).
    for (const { usuarioId, sessionId } of manager.getSesionesActivas()) {

        const socket = manager.getSocketActivoDe(usuarioId);

        if (socket) {

            console.log("➡️ Sesión activa ya existente al iniciar:", sessionId);

            conectar(socket, sessionId);

        }

    }

}

module.exports = iniciarBot;

// Para pruebas y para la ruta de salud.
module.exports.revisarSalud = revisarSalud;
module.exports.estadoBot = () => {
    const primera = registradas.entries().next();
    return {
        // Compatibilidad: la primera sesión registrada.
        sesionActual: primera.done ? null : primera.value[0],
        socketActual: primera.done ? null : primera.value[1].socket,
        sesiones: [...registradas].map(([sessionId, r]) => ({ sessionId, usuarioId: r.usuarioId, socket: r.socket }))
    };
};
