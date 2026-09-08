// ==========================================================================
// Entorno fake para las pruebas del Automation Engine (Fase 2B).
//
// Inyecta, vía require.cache, un sustituto de ../../lib/supabase, y luego
// recarga limpios (delete + require) los módulos REALES bajo prueba:
// eventRules.js, executionGuard.js, repo/eventSessions.js,
// repo/automationConfig.js, engine.js.
//
// Mismo patrón que backend/tests/sesiones/entornoFake.js — ningún socket
// real, ninguna llamada de red, ningún WhatsApp.
// ==========================================================================

const path = require("path");

const { crearFakeSupabaseAutomation } = require("./fakeSupabaseAutomation");

const RAIZ = path.resolve(__dirname, "../..");

const RUTAS = {
    supabase: path.join(RAIZ, "lib/supabase.js"),
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

function limpiarCache() {
    for (const ruta of Object.values(RUTAS)) {
        delete require.cache[ruta];
    }
}

function crearEntorno() {

    limpiarCache();

    const fakeSupabase = crearFakeSupabaseAutomation();

    inyectar(RUTAS.supabase, fakeSupabase.client);

    // Recargar limpios los módulos reales bajo prueba, en orden de
    // dependencia, para que todos tomen la inyección de arriba.
    delete require.cache[RUTAS.eventRules];
    delete require.cache[RUTAS.executionGuard];
    delete require.cache[RUTAS.eventSessionsRepo];
    delete require.cache[RUTAS.automationConfigRepo];
    delete require.cache[RUTAS.engine];

    const eventRules = require(RUTAS.eventRules);
    const executionGuard = require(RUTAS.executionGuard);
    const eventSessionsRepo = require(RUTAS.eventSessionsRepo);
    const automationConfigRepo = require(RUTAS.automationConfigRepo);
    const engine = require(RUTAS.engine);

    return {
        fakeSupabase,
        eventRules,
        executionGuard,
        eventSessionsRepo,
        automationConfigRepo,
        engine,
        limpiar: limpiarCache
    };

}

module.exports = { crearEntorno, RUTAS };
