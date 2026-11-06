// ==========================================================================
// PRUEBAS: sorteos/estadosProgramacion.js (F1-B, 06/11/2026).
//
// Fija los VALORES que tenían las constantes antes de renombrarlas (no
// cambia ninguna regla), que el espejo del panel coincide, y que el nombre
// ambiguo ESTADOS_SIN_PUBLICAR no vuelve a aparecer.
//
//     node backend/tests/sorteos/estadosProgramacion.test.js
// ==========================================================================

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);
const E = require(r("sorteos/estadosProgramacion.js"));

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

prueba("valores idénticos a los anteriores", () => {
    // administracion.js / servicio.js / gestionEventos.js
    assert.deepStrictEqual([...E.ESTADOS_EDITABLES], ["borrador", "programado"]);
    // administracion.js «ESTADOS_SIN_PUBLICAR» (eliminar sin actividad)
    assert.deepStrictEqual([...E.ESTADOS_NUNCA_PUBLICADOS], ["borrador", "programado", "cancelado"]);
    // reservasAnticipadas.js «ESTADOS_SIN_PUBLICAR»
    assert.deepStrictEqual([...E.ESTADOS_PENDIENTES_DE_PUBLICAR], ["borrador", "programado", "publicando", "fallido"]);
});

prueba("inmutables", () => {
    for (const k of Object.keys(E)) assert.ok(Object.isFrozen(E[k]), k);
});

prueba("reservasAnticipadas reexporta la misma lista", () => {
    require.cache[r("lib/supabase.js")] = { id: r("lib/supabase.js"), filename: r("lib/supabase.js"), loaded: true, exports: { from() { throw new Error("sin base en esta prueba"); } } };
    const ra = require(r("sorteos/reservasAnticipadas.js"));
    assert.strictEqual(ra.ESTADOS_PENDIENTES_DE_PUBLICAR, E.ESTADOS_PENDIENTES_DE_PUBLICAR);
    assert.ok(!("ESTADOS_SIN_PUBLICAR" in ra));
});

prueba("el panel usa la misma lista (impactoReinicio.ts)", () => {
    const ts = fs.readFileSync(r("../frontend/services/tablas/impactoReinicio.ts"), "utf8");
    const m = ts.match(/export const ESTADOS_PENDIENTES_DE_PUBLICAR = (\[[^\]]*\]);/);
    assert.ok(m, "constante del panel localizada");
    assert.deepStrictEqual(JSON.parse(m[1]), [...E.ESTADOS_PENDIENTES_DE_PUBLICAR]);
});

prueba("ningún código usa ya el nombre ambiguo ni copia ESTADOS_EDITABLES", () => {
    const archivos = [];
    const recorrer = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) { if (!["node_modules", "tests", ".next"].includes(e.name)) recorrer(p); continue; }
            if (/\.(js|ts|tsx)$/.test(e.name) && !e.name.startsWith("_")) archivos.push(p);
        }
    };
    recorrer(RAIZ);
    recorrer(r("../frontend/services"));
    recorrer(r("../frontend/components"));
    const ambiguos = archivos.filter(p => p !== r("sorteos/estadosProgramacion.js") && /ESTADOS_SIN_PUBLICAR/.test(fs.readFileSync(p, "utf8")));
    const copias = archivos.filter(p => p !== r("sorteos/estadosProgramacion.js") && /const ESTADOS_EDITABLES\s*=\s*\[/.test(fs.readFileSync(p, "utf8")));
    assert.deepStrictEqual(ambiguos.map(p => path.relative(RAIZ, p)), []);
    assert.deepStrictEqual(copias.map(p => path.relative(RAIZ, p)), []);
});

let fallos = 0;
for (const { n, fn } of pruebas) {
    try { fn(); console.log(`✅ ${n}`); } catch (e) { fallos++; console.log(`❌ ${n}\n   ${e.message}`); }
}
console.log(`\n${pruebas.length - fallos}/${pruebas.length} pruebas OK`);
process.exitCode = fallos ? 1 : 0;
