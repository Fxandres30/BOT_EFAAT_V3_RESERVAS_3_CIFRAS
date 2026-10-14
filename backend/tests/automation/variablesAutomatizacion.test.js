// ==========================================================================
// PRUEBAS — variables de los mensajes automáticos (apertura, recordatorio,
// actualización, cierre).
//
// Error real en producción: "variables sin resolver (loteria, fecha) — no
// se envía". El catálogo global ofrece {loteria} (alias del nombre del
// evento) y {fecha}, pero automation/engine.js no los conocía. Además
// "{{loteria}}" (formato del resto del panel) se leía como "{loteria}" y
// dejaba llaves sueltas.
//
//     node backend/tests/automation/variablesAutomatizacion.test.js
// ==========================================================================

const assert = require("assert");
const { resolverVariables } = require("../../automation/variableResolver");

// engine.js carga módulos con Supabase: se prueba la función pura sin red.
const path = require("path");
const rutaSupabase = path.resolve(__dirname, "../../lib/supabase.js");
require.cache[rutaSupabase] = { id: rutaSupabase, filename: rutaSupabase, loaded: true, exports: { from() { throw new Error("sin red"); }, rpc() { throw new Error("sin red"); } } };
const { construirVariablesDesdeEvento } = require("../../automation/engine");

const evento = { nombre_evento: "Lotería de Boyacá", fecha_evento: "2026-10-14", hora_cierre: "22:00", valor: 2000, reservados: 10, libres: 90 };

const pruebas = [
    ["{loteria}, {evento} y {fecha} se resuelven con datos reales del evento", () => {
        const r = resolverVariables("🎰 {loteria} · {evento} · {fecha} · {hora_cierre}", construirVariablesDesdeEvento(evento));
        assert.strictEqual(r.completo, true);
        assert.strictEqual(r.texto, "🎰 Lotería de Boyacá · Lotería de Boyacá · 2026-10-14 · 22:00");
    }],
    ["sin fecha en el evento: {fecha} sigue faltando y NO se inventa", () => {
        const r = resolverVariables("Sorteo {fecha}", construirVariablesDesdeEvento({ ...evento, fecha_evento: null }));
        assert.strictEqual(r.completo, false);
        assert.deepStrictEqual(r.faltantes, ["fecha"]);
    }],
    ["{{variable}} (formato del panel) se resuelve completo, sin llaves sueltas", () => {
        const r = resolverVariables("{{loteria}} / {{ valor }}", construirVariablesDesdeEvento(evento));
        assert.strictEqual(r.texto, "Lotería de Boyacá / 2000");
    }],
    ["variable desconocida sigue bloqueando el envío", () => {
        const r = resolverVariables("Hola {{inventada}}", construirVariablesDesdeEvento(evento));
        assert.strictEqual(r.completo, false);
        assert.deepStrictEqual(r.faltantes, ["inventada"]);
        assert.strictEqual(r.texto, "Hola {{inventada}}");
    }]
];

let ok = 0, falla = 0;
for (const [n, fn] of pruebas) {
    try { fn(); ok++; console.log(`✅ ${n}`); }
    catch (e) { falla++; console.log(`❌ ${n}`); console.log(String(e.stack || e)); }
}
console.log(`\n============================\nTOTAL: ${ok + falla}  ✅ PASA: ${ok}  ❌ FALLA: ${falla}\n============================`);
process.exit(falla ? 1 : 0);
