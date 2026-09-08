// ==========================================================================
// Entorno fake para las pruebas del Scheduler (Fase 4B).
//
// Reutiliza (no duplica) el fake de Supabase compartido de Fase 2B/3/4A
// (tests/automation/fakeSupabaseAutomation.js, ya extendido con
// reservas_actividad/.gte() para esta fase) e inyecta un socket Baileys
// 100% fake para services/baileys/send.js EXISTENTE — nunca WhatsApp real,
// nunca red real, ningún setInterval real corriendo salvo cuando una
// prueba concreta lo pide explícitamente (start()/stop()).
// ==========================================================================

const path = require("path");

const { crearFakeSupabaseAutomation } = require("../automation/fakeSupabaseAutomation");

const RAIZ = path.resolve(__dirname, "../..");

const RUTAS = {
    supabase: path.join(RAIZ, "lib/supabase.js"),

    eventRules: path.join(RAIZ, "automation/eventRules.js"),
    executionGuard: path.join(RAIZ, "automation/executionGuard.js"),
    variableResolver: path.join(RAIZ, "automation/variableResolver.js"),
    messageSelector: path.join(RAIZ, "automation/messageSelector.js"),
    messagesRepo: path.join(RAIZ, "automation/repo/messages.js"),
    eventSessionsRepo: path.join(RAIZ, "automation/repo/eventSessions.js"),
    automationConfigRepo: path.join(RAIZ, "automation/repo/automationConfig.js"),
    eventosBotRepo: path.join(RAIZ, "automation/repo/eventosBot.js"),
    reservasActividadRepo: path.join(RAIZ, "automation/repo/reservasActividad.js"),
    engine: path.join(RAIZ, "automation/engine.js"),
    scheduler: path.join(RAIZ, "automation/scheduler.js")
};

function inyectar(rutaAbs, exportsObj) {
    require.cache[rutaAbs] = {
        id: rutaAbs,
        filename: rutaAbs,
        loaded: true,
        exports: exportsObj
    };
}

function limpiarCache() {
    for (const ruta of Object.values(RUTAS)) {
        delete require.cache[ruta];
    }
}

// Socket Baileys FAKE — implementa exactamente lo que
// services/baileys/send.js (EXISTENTE, sin cambios) necesita:
// sendPresenceUpdate() y sendMessage(). Nunca WhatsApp real.
function crearFakeSock({ sessionId = "sesion-scheduler", usuarioId, telefono = "573000000000" } = {}) {

    const llamadas = { sendMessage: [], sendPresenceUpdate: 0 };

    const sock = {

        context: { sessionId, usuarioId, telefono, nombreSesion: "Sesión de prueba", estado: "conectado" },

        sendPresenceUpdate: async () => { llamadas.sendPresenceUpdate++; },

        sendMessage: async (jid, contenido, opts) => {
            llamadas.sendMessage.push({ jid, contenido, opts });
            return { key: { id: `fake-${llamadas.sendMessage.length}` } };
        }

    };

    return { sock, llamadas };

}

// Acelera setTimeout globalmente (delay -> 0) — services/baileys/send.js
// espera entre 1 y 7 segundos REALES antes de cada envío ("escribiendo...").
// Mismo patrón que tests/mensajes/entornoFake.js.
let _setTimeoutOriginal = null;

function acelerarTimers() {
    if (_setTimeoutOriginal) return;
    _setTimeoutOriginal = global.setTimeout;
    global.setTimeout = (fn, _ms, ...args) => _setTimeoutOriginal(fn, 0, ...args);
}

function restaurarTimers() {
    if (!_setTimeoutOriginal) return;
    global.setTimeout = _setTimeoutOriginal;
    _setTimeoutOriginal = null;
}

function crearEntorno({ fakeSupabaseExistente = null } = {}) {

    limpiarCache();

    const fakeSupabase = fakeSupabaseExistente || crearFakeSupabaseAutomation();

    inyectar(RUTAS.supabase, fakeSupabase.client);

    const eventRules = require(RUTAS.eventRules);
    const executionGuard = require(RUTAS.executionGuard);
    const eventSessionsRepo = require(RUTAS.eventSessionsRepo);
    const automationConfigRepo = require(RUTAS.automationConfigRepo);
    const eventosBotRepo = require(RUTAS.eventosBotRepo);
    const reservasActividadRepo = require(RUTAS.reservasActividadRepo);
    const engine = require(RUTAS.engine);
    const scheduler = require(RUTAS.scheduler);

    return {
        fakeSupabase,
        eventRules,
        executionGuard,
        eventSessionsRepo,
        automationConfigRepo,
        eventosBotRepo,
        reservasActividadRepo,
        engine,
        scheduler,
        crearFakeSock
    };

}

module.exports = { crearEntorno, crearFakeSock, acelerarTimers, restaurarTimers, RUTAS };
