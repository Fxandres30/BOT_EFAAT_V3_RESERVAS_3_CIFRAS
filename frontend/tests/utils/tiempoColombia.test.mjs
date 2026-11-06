// ==========================================================================
// PRUEBAS: frontend/lib/tiempo/colombia.ts (F1-B, 06/11/2026).
//
// 1) El espejo del panel da EXACTAMENTE lo mismo que la fuente del backend
//    (backend/shared/tiempo/colombia.js), minuto a minuto.
// 2) Da lo mismo que las expresiones que sustituyó en el panel
//    (FORMATO_DIA de estadoProgramacion/estadoSorteoPrecio, colombiaDesdeIso
//    de components/sorteos/fechas.ts, el "-05:00" escrito a mano).
//
//     node frontend/tests/utils/tiempoColombia.test.mjs
// ==========================================================================

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const FRONT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const ts = require(path.join(FRONT, "node_modules/typescript"));

function cargarTs(rutaAbs) {
    const { outputText } = ts.transpileModule(fs.readFileSync(rutaAbs, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
    });
    const modulo = { exports: {} };
    new Function("module", "exports", "require", outputText)(modulo, modulo.exports, require);
    return modulo.exports;
}

const F = cargarTs(path.join(FRONT, "lib/tiempo/colombia.ts"));
const B = require(path.join(FRONT, "../backend/shared/tiempo/colombia.js"));

// ---- expresiones ANTIGUAS del panel, literales ----
const FORMATO_DIA_ANTIGUO = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" });
const colombiaDesdeIsoAntiguo = (d) => {
    const p = Object.fromEntries(
        new Intl.DateTimeFormat("en-CA", {
            timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit",
            hour: "2-digit", minute: "2-digit", hourCycle: "h23"
        }).formatToParts(d).map(x => [x.type, x.value])
    );
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
};

const DIAS_INICIO = ["2026-10-22T00:00:00Z", "2026-12-31T00:00:00Z", "2028-02-28T00:00:00Z"];
let comparados = 0;
function cadaMinuto(fn) {
    for (const inicio of DIAS_INICIO) {
        const base = new Date(inicio).getTime();
        for (let m = 0; m < 48 * 60; m++) { fn(new Date(base + m * 60000 + 37000)); comparados++; }
    }
}

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

prueba("constantes iguales en panel y backend", () => {
    assert.strictEqual(F.ZONA_COLOMBIA, B.ZONA_COLOMBIA);
    assert.strictEqual(F.DESFASE_COLOMBIA, B.DESFASE_COLOMBIA);
    assert.strictEqual(F.DESFASE_COLOMBIA, "-05:00");
});
prueba("fechaColombia: panel = backend = FORMATO_DIA antiguo", () => cadaMinuto(a => {
    assert.strictEqual(F.fechaColombia(a), B.fechaColombia(a), a.toISOString());
    assert.strictEqual(F.fechaColombia(a), FORMATO_DIA_ANTIGUO.format(a), a.toISOString());
}));
prueba("partesColombia: panel = backend = colombiaDesdeIso antiguo", () => cadaMinuto(a => {
    assert.deepStrictEqual(F.partesColombia(a), B.partesColombia(a), a.toISOString());
    const { fecha, hora } = F.partesColombia(a);
    assert.strictEqual(`${fecha}T${hora}`, colombiaDesdeIsoAntiguo(a), a.toISOString());
}));

let fallos = 0;
for (const { n, fn } of pruebas) {
    try { fn(); console.log(`✅ ${n}`); } catch (e) { fallos++; console.log(`❌ ${n}\n   ${e.message}`); }
}
console.log(`\n${pruebas.length - fallos}/${pruebas.length} pruebas OK · ${comparados} instantes comparados`);
process.exitCode = fallos ? 1 : 0;
