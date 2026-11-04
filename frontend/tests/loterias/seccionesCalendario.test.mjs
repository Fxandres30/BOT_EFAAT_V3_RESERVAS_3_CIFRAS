// ==========================================================================
// PRUEBAS (frontend) — secciones desplegables del calendario de loterías:
//   - ambas empiezan desplegadas;
//   - plegar/desplegar una no afecta a la otra;
//   - el estado se recuerda en la pestaña (sessionStorage) y aguanta datos
//     corruptos o almacenamiento bloqueado;
//   - al buscar, la sección plegada con resultados se despliega sola;
//   - la página usa ese estado: botón con aria-expanded, flecha según el
//     estado, contador fuera de la parte plegable, búsqueda que despliega.
//
// Carga el servicio TypeScript REAL (mismo cargador que
// tests/tablas/seccionesPanel.test.mjs).
//
//     node frontend/tests/loterias/seccionesCalendario.test.mjs
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
    new Function("require", "module", "exports", outputText)(require, modulo, modulo.exports);
    return modulo.exports;
}

const {
    SECCIONES_INICIALES,
    CLAVE_SECCIONES,
    leerSecciones,
    guardarSecciones,
    alternarSeccion,
    desplegarConResultados
} = cargarTs(path.join(FRONT, "services/loterias/seccionesCalendario.ts"));

function almacenFalso() {
    const datos = new Map();
    return { datos, getItem: (k) => (datos.has(k) ? datos.get(k) : null), setItem: (k, v) => { datos.set(k, String(v)); } };
}
const bloqueado = { getItem() { throw new Error("SecurityError"); }, setItem() { throw new Error("QuotaExceededError"); } };

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

prueba("estado inicial: ambas secciones desplegadas", () => {
    assert.deepStrictEqual(SECCIONES_INICIALES, { chance: true, tradicional: true });
    assert.deepStrictEqual(leerSecciones(almacenFalso()), { chance: true, tradicional: true });
    assert.deepStrictEqual(leerSecciones(null), { chance: true, tradicional: true });
});

prueba("plegar Chances no afecta a Sorteos tradicionales (y al revés)", () => {
    const soloChances = alternarSeccion(SECCIONES_INICIALES, "chance");
    assert.deepStrictEqual(soloChances, { chance: false, tradicional: true });
    const soloTrad = alternarSeccion(SECCIONES_INICIALES, "tradicional");
    assert.deepStrictEqual(soloTrad, { chance: true, tradicional: false });
    const ambas = alternarSeccion(soloChances, "tradicional");
    assert.deepStrictEqual(ambas, { chance: false, tradicional: false });
    assert.deepStrictEqual(alternarSeccion(ambas, "chance"), { chance: true, tradicional: false }, "desplegar una deja la otra plegada");
    assert.deepStrictEqual(SECCIONES_INICIALES, { chance: true, tradicional: true }, "no muta el estado anterior");
});

prueba("se recuerda en la pestaña: guardar y volver a leer; claves desconocidas o corruptas no rompen", () => {
    const a = almacenFalso();
    guardarSecciones(a, { chance: false, tradicional: true });
    assert.deepStrictEqual(JSON.parse(a.datos.get(CLAVE_SECCIONES)), { chance: false, tradicional: true });
    assert.deepStrictEqual(leerSecciones(a), { chance: false, tradicional: true });
    a.setItem(CLAVE_SECCIONES, "{no es json");
    assert.deepStrictEqual(leerSecciones(a), { chance: true, tradicional: true });
    a.setItem(CLAVE_SECCIONES, JSON.stringify({ chance: "no", tradicional: false, otra: 1 }));
    assert.deepStrictEqual(leerSecciones(a), { chance: true, tradicional: false });
    guardarSecciones(a, { chance: true, tradicional: true, extra: "x" });
    assert.deepStrictEqual(Object.keys(JSON.parse(a.datos.get(CLAVE_SECCIONES))), ["chance", "tradicional"], "solo se guardan las dos secciones");
});

prueba("almacenamiento bloqueado: se usa el predeterminado y guardar no lanza", () => {
    assert.deepStrictEqual(leerSecciones(bloqueado), { chance: true, tradicional: true });
    assert.doesNotThrow(() => guardarSecciones(bloqueado, { chance: false, tradicional: false }));
});

prueba("búsqueda: despliega SOLO la sección plegada que tiene resultados", () => {
    const plegadas = { chance: false, tradicional: false };
    assert.deepStrictEqual(desplegarConResultados(plegadas, "sinu", { chance: 2, tradicional: 0 }), { chance: true, tradicional: false });
    assert.deepStrictEqual(desplegarConResultados(plegadas, "medellín", { chance: 0, tradicional: 1 }), { chance: false, tradicional: true });
    assert.deepStrictEqual(desplegarConResultados(plegadas, "lot", { chance: 3, tradicional: 15 }), { chance: true, tradicional: true });
    assert.strictEqual(desplegarConResultados(plegadas, "zzz", { chance: 0, tradicional: 0 }), plegadas, "sin resultados no cambia nada");
    assert.strictEqual(desplegarConResultados(plegadas, "   ", { chance: 27, tradicional: 15 }), plegadas, "búsqueda vacía no despliega");
    const abiertas = { chance: true, tradicional: false };
    assert.strictEqual(desplegarConResultados(abiertas, "sinu", { chance: 2, tradicional: 0 }), abiertas, "ya desplegada: mismo objeto (no re-render)");
});

prueba("la página: botón con aria-expanded, flecha según el estado, contador visible y búsqueda que despliega", () => {
    const fuente = fs.readFileSync(path.join(FRONT, "components/loterias/CalendarioLoteriasPage.tsx"), "utf8");
    assert.match(fuente, /aria-expanded=\{abierta\}/);
    assert.match(fuente, /aria-controls=\{`loterias-\$\{categoria\}`\}/);
    assert.match(fuente, /\{abierta \? <ChevronDown size=\{20\} aria-hidden \/> : <ChevronRight size=\{20\} aria-hidden \/>\}/, "abajo = desplegada, derecha = plegada");
    assert.match(fuente, /onClick=\{\(\) => alternar\(categoria\)\}/, "clic en el encabezado (incluye la flecha)");
    assert.match(fuente, /<div id=\{`loterias-\$\{categoria\}`\} hidden=\{!abierta\}>/);
    const cabecera = fuente.slice(fuente.indexOf("<h2 className={styles.seccionTitulo}>"), fuente.indexOf("<div id={`loterias-"));
    assert.ok(cabecera.includes("styles.contador"), "el contador está en el encabezado, fuera de la parte que se pliega");
    assert.ok(/Clover/.test(cabecera) || /Icono/.test(cabecera), "icono por categoría");
    assert.match(fuente, /categoria: "chance" as const, titulo: "Chances", Icono: Clover/);
    assert.match(fuente, /categoria: "tradicional" as const, titulo: "Sorteos tradicionales", Icono: Landmark/);
    assert.match(fuente, /onChange=\{e => buscar\(e\.target\.value\)\}/);
    assert.match(fuente, /desplegarConResultados\(secciones, texto, resultados\)/);
});

let ok = 0, falla = 0;
for (const { n, fn } of pruebas) {
    try { await fn(); ok++; console.log(`✅ ${n}`); }
    catch (e) { falla++; console.log(`❌ ${n}`); console.log(String(e && e.stack || e)); }
}
console.log(`\n============================\nTOTAL: ${ok + falla}  ✅ PASA: ${ok}  ❌ FALLA: ${falla}\n============================`);
process.exitCode = falla ? 1 : 0;
