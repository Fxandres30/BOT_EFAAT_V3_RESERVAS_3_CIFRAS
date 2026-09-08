// ==========================================================================
// Entorno fake para las pruebas de integración Fase 3 (detectarEvento.js
// <-> Automation Engine).
//
// Reutiliza (no duplica) el fake de Supabase de Fase 2B
// (tests/automation/fakeSupabaseAutomation.js, ya extendido con la tabla
// "eventos_bot" para esta fase) e inyecta, vía require.cache, un stub del
// escáner de identidades (fire-and-forget, fuera de alcance) y un socket
// Baileys FAKE (nunca WhatsApp real, nunca red real).
//
// Recarga limpios los módulos REALES bajo prueba — detectarEvento.js,
// extraerEvento.js, consultarEvento.js, guardarEvento.js, configEvento.js,
// abrirGrupo.js, services/baileys/groupQueue.js y todo automation/ — NINGUNO
// de ellos se modifica ni se duplica.
// ==========================================================================

const path = require("path");

const { crearFakeSupabaseAutomation } = require("../automation/fakeSupabaseAutomation");

const RAIZ = path.resolve(__dirname, "../..");

const RUTAS = {
    supabase: path.join(RAIZ, "lib/supabase.js"),
    escaner: path.join(RAIZ, "bot/funciones/usuarios/escanerIdentidadesLifecycle.js"),

    groupQueue: path.join(RAIZ, "services/baileys/groupQueue.js"),
    abrirGrupo: path.join(RAIZ, "bot/funciones/eventos/grupos/abrirGrupo.js"),
    consultarEvento: path.join(RAIZ, "bot/funciones/eventos/consultarEvento.js"),
    guardarEvento: path.join(RAIZ, "bot/funciones/eventos/guardarEvento.js"),
    configEvento: path.join(RAIZ, "bot/funciones/eventos/configEvento.js"),
    extraerEvento: path.join(RAIZ, "bot/funciones/eventos/extraerEvento.js"),
    detectarEvento: path.join(RAIZ, "bot/funciones/eventos/detectarEvento.js"),

    eventRules: path.join(RAIZ, "automation/eventRules.js"),
    executionGuard: path.join(RAIZ, "automation/executionGuard.js"),
    eventSessionsRepo: path.join(RAIZ, "automation/repo/eventSessions.js"),
    automationConfigRepo: path.join(RAIZ, "automation/repo/automationConfig.js"),
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

function limpiarCacheModulosReales() {
    for (const clave of [
        "groupQueue", "abrirGrupo", "consultarEvento", "guardarEvento",
        "configEvento", "extraerEvento", "detectarEvento",
        "eventRules", "executionGuard", "eventSessionsRepo",
        "automationConfigRepo", "engine"
    ]) {
        delete require.cache[RUTAS[clave]];
    }
}

function limpiarCacheCompleta() {
    for (const ruta of Object.values(RUTAS)) {
        delete require.cache[ruta];
    }
}

// Socket Baileys FAKE — nunca WhatsApp real. Registra cada llamada a
// groupSettingUpdate() para que las pruebas puedan verificar exactamente
// cuándo (y con qué ajuste) se usó el mecanismo EXISTENTE de apertura, sin
// tocar ninguna red real.
function crearFakeSock({ sessionId = "sesion-fake", usuarioId, telefono = "573000000000" } = {}) {

    const llamadas = { groupSettingUpdate: [], groupMetadata: 0 };

    const sock = {

        context: {
            sessionId,
            usuarioId,
            telefono,
            nombreSesion: "Sesión de prueba",
            estado: "conectado"
        },

        groupMetadata: async (jid) => {
            llamadas.groupMetadata++;
            return { id: jid, subject: "Grupo de prueba", desc: null, participants: [] };
        },

        groupSettingUpdate: async (jid, ajuste) => {
            llamadas.groupSettingUpdate.push({ jid, ajuste });
            return true;
        }

    };

    return { sock, llamadas };

}

const STUB_ESCANER = {
    iniciarEscanerIdentidades: () => {},
    detenerEscanerIdentidades: () => {},
    escanearTodosLosGrupos: async () => null,
    // fire-and-forget en detectarEvento.js (.catch(...)) — fuera de alcance
    // de esta fase, se deja inerte a propósito.
    escanearGrupo: async () => null
};

// crearEntorno({ fakeSupabaseExistente }) — si se pasa un fake ya creado
// (mismos datos, misma "base de datos"), NO se crea uno nuevo: solo se
// vuelven a cargar limpios los módulos reales (simula exactamente un
// reinicio del proceso backend, que pierde todo estado en memoria pero
// conserva lo ya persistido en Supabase — ver deteccionAutomation.test.js,
// caso "restart").
function crearEntorno({ fakeSupabaseExistente = null } = {}) {

    const fakeSupabase = fakeSupabaseExistente || crearFakeSupabaseAutomation();

    if (fakeSupabaseExistente) {
        limpiarCacheModulosReales(); // conserva la inyección de supabase/escáner ya hecha
    } else {
        limpiarCacheCompleta();
        inyectar(RUTAS.supabase, fakeSupabase.client);
        inyectar(RUTAS.escaner, STUB_ESCANER);
    }

    const { detectarEvento } = require(RUTAS.detectarEvento);
    const engine = require(RUTAS.engine);
    const eventSessionsRepo = require(RUTAS.eventSessionsRepo);

    return {
        fakeSupabase,
        detectarEvento,
        engine,
        eventSessionsRepo,
        crearFakeSock
    };

}

module.exports = { crearEntorno, crearFakeSock, RUTAS };
