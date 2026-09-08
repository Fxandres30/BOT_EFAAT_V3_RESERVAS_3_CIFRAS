// ==========================================================================
// Entorno fake para las pruebas del Message Pool (Fase 4A).
//
// Reutiliza (no duplica) el fake de Supabase compartido de Fase 2B/3
// (tests/automation/fakeSupabaseAutomation.js, ya extendido con
// automation_messages/automation_message_uses y soporte .is() para esta
// fase) e inyecta un socket Baileys 100% fake para services/baileys/send.js
// EXISTENTE (nunca WhatsApp real, nunca red real).
// ==========================================================================

const path = require("path");

const { crearFakeSupabaseAutomation } = require("../automation/fakeSupabaseAutomation");

const RAIZ = path.resolve(__dirname, "../..");

const RUTAS = {
    supabase: path.join(RAIZ, "lib/supabase.js"),

    variableResolver: path.join(RAIZ, "automation/variableResolver.js"),
    messagesRepo: path.join(RAIZ, "automation/repo/messages.js"),
    messageSelector: path.join(RAIZ, "automation/messageSelector.js"),
    executionGuard: path.join(RAIZ, "automation/executionGuard.js"),
    eventSessionsRepo: path.join(RAIZ, "automation/repo/eventSessions.js"),
    automationConfigRepo: path.join(RAIZ, "automation/repo/automationConfig.js"),
    eventRules: path.join(RAIZ, "automation/eventRules.js"),
    engine: path.join(RAIZ, "automation/engine.js")
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
function crearFakeSock({ sessionId = "sesion-msg", usuarioId, telefono = "573000000000" } = {}) {

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
// (EXISTENTE, sin tocar) espera entre 1 y 7 segundos REALES antes de cada
// envío (simula "escribiendo..."); sin esto, cada prueba que envía un
// mensaje real tardaría varios segundos. Mismo patrón ya usado en
// backend/tests/sesiones/entornoFake.js.
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

function crearEntorno() {

    limpiarCache();

    const fakeSupabase = crearFakeSupabaseAutomation();

    inyectar(RUTAS.supabase, fakeSupabase.client);

    const variableResolver = require(RUTAS.variableResolver);
    const messagesRepo = require(RUTAS.messagesRepo);
    const messageSelector = require(RUTAS.messageSelector);
    const executionGuard = require(RUTAS.executionGuard);
    const eventSessionsRepo = require(RUTAS.eventSessionsRepo);
    const engine = require(RUTAS.engine);

    return {
        fakeSupabase,
        variableResolver,
        messagesRepo,
        messageSelector,
        executionGuard,
        eventSessionsRepo,
        engine,
        crearFakeSock
    };

}

module.exports = { crearEntorno, crearFakeSock, acelerarTimers, restaurarTimers, RUTAS };
