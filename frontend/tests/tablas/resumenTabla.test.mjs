// ==========================================================================
// PRUEBAS (frontend) — Reservas: orden de las tarjetas de precio y resumen
// de cada tabla (services/tablas/resumenTabla.ts, módulo puro: sin red ni
// Supabase).
//
//   - las tablas con sorteo activo van primero, sin perder, duplicar ni
//     reordenar el resto, y el orden cambia con el estado;
//   - libres + reservados + pagados = total, con «en proceso» y «bloqueado»
//     como reservados; ocupación = no libres / total;
//   - el recaudo solo cuenta números PAGADOS del sorteo activo × precio:
//     nunca reservas ni pagos de otro sorteo; sin sorteo activo, null.
//
//     node frontend/tests/tablas/resumenTabla.test.mjs
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
    const requerir = (id) => id.startsWith(".") ? cargarTs(path.resolve(path.dirname(rutaAbs), `${id}.ts`)) : require(id);
    const modulo = { exports: {} };
    new Function("module", "exports", "require", outputText)(modulo, modulo.exports, requerir);
    return modulo.exports;
}

const { ordenarPorSorteoActivo, calcularResumenTabla } = cargarTs(path.join(FRONT, "services/tablas/resumenTabla.ts"));

let ok = 0;
const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

// 100 números: los primeros con los estados dados, el resto libres.
function tabla(estados, extra = {}) {
    return Array.from({ length: 100 }, (_, i) => ({ estado: estados[i] || "libre", ...extra, ...(extra.porIndice?.[i] || {}) }));
}
const ACTIVO = { id: "ev-1", identidad_evento_real: "ident-1" };
const delActivo = { identidad_evento_real: "ident-1", evento_id: "ev-1" };
const sumaOk = (r) => assert.strictEqual(r.libres + r.reservados + r.pagados, r.total);

// --------------------------------------------------------------- orden ---

prueba("orden: los precios con sorteo activo primero ($1.000 y $5.000 consecutivos), el resto en su orden", () => {
    const e = (estado) => [{ estado }];
    const lista = [
        { precio: 500, entradas: e("sin_sorteo") },
        { precio: 1000, entradas: e("activo") },
        { precio: 2000, entradas: e("programado") },
        { precio: 3000, entradas: e("revision") },
        { precio: 5000, entradas: [{ estado: "programado" }, { estado: "activo" }] },
        { precio: 10000, entradas: e("no_disponible") }
    ];
    const r = ordenarPorSorteoActivo(lista);
    assert.deepStrictEqual(r.map(t => t.precio), [1000, 5000, 500, 2000, 3000, 10000]);
    assert.strictEqual(new Set(r).size, lista.length, "ni se pierde ni se duplica ninguna");
    assert.deepStrictEqual(lista.map(t => t.precio), [500, 1000, 2000, 3000, 5000, 10000], "no muta la lista original");
});

prueba("orden: sin estado todavía (consultando) o sin activos, queda el orden original", () => {
    const lista = [{ precio: 1000, entradas: null }, { precio: 2000, entradas: null }, { precio: 3000, entradas: [{ estado: "sin_sorteo" }] }];
    assert.deepStrictEqual(ordenarPorSorteoActivo(lista).map(t => t.precio), [1000, 2000, 3000]);
});

prueba("orden: se actualiza cuando cambia el estado del sorteo", () => {
    const antes = [{ precio: 1000, entradas: [{ estado: "activo" }] }, { precio: 2000, entradas: [{ estado: "programado" }] }];
    const despues = [{ precio: 1000, entradas: [{ estado: "sin_sorteo" }] }, { precio: 2000, entradas: [{ estado: "activo" }] }];
    assert.deepStrictEqual(ordenarPorSorteoActivo(antes).map(t => t.precio), [1000, 2000]);
    assert.deepStrictEqual(ordenarPorSorteoActivo(despues).map(t => t.precio), [2000, 1000]);
});

// ------------------------------------------------------------- resumen ---

prueba("tabla completamente libre: 100 libres, 0 %, recaudo $0 con sorteo activo", () => {
    const r = calcularResumenTabla(tabla([]), 5000, ACTIVO);
    assert.deepStrictEqual([r.total, r.libres, r.reservados, r.pagados, r.ocupacion, r.recaudo], [100, 100, 0, 0, 0, 0]);
    sumaOk(r);
});

prueba("tabla sin sorteo activo: cuenta estados reales pero no afirma recaudo (null)", () => {
    const r = calcularResumenTabla(tabla(["pagado", "pagado", "reservado"], delActivo), 5000, null);
    assert.deepStrictEqual([r.pagados, r.reservados, r.libres, r.ocupacion], [2, 1, 97, 3]);
    assert.strictEqual(r.recaudo, null);
    assert.strictEqual(r.pagadosDeOtroSorteo, 0);
    sumaOk(r);
});

prueba("tabla con números reservados: no suman recaudo (reservas pendientes)", () => {
    const r = calcularResumenTabla(tabla(Array(10).fill("reservado"), delActivo), 5000, ACTIVO);
    assert.deepStrictEqual([r.reservados, r.pagados, r.ocupacion, r.recaudo], [10, 0, 10, 0]);
    sumaOk(r);
});

prueba("tabla con números pagados del sorteo activo: recaudo = pagados × precio", () => {
    const r = calcularResumenTabla(tabla(Array(15).fill("pagado"), delActivo), 5000, ACTIVO);
    assert.deepStrictEqual([r.pagados, r.pagadosDelSorteo, r.recaudo, r.ocupacion], [15, 15, 75000, 15]);
    sumaOk(r);
});

prueba("estados mezclados: en proceso y bloqueado cuentan como reservados; la suma coincide con el total", () => {
    const estados = [...Array(20).fill("reservado"), ...Array(2).fill("en_proceso"), "bloqueado", ...Array(15).fill("pagado")];
    const r = calcularResumenTabla(tabla(estados, delActivo), 2000, ACTIVO);
    assert.deepStrictEqual([r.reservados, r.pagados, r.libres, r.ocupacion, r.recaudo], [23, 15, 62, 38, 30000]);
    sumaOk(r);
});

prueba("tabla física compartida: los pagados de otro sorteo no suman al recaudo (sin duplicar pagos)", () => {
    const porIndice = { 0: { identidad_evento_real: "ident-otro" }, 1: { identidad_evento_real: "ident-otro" }, 2: { identidad_evento_real: null, evento_id: null } };
    const r = calcularResumenTabla(tabla(["pagado", "pagado", "pagado", "pagado", "pagado"], { ...delActivo, porIndice }), 1000, ACTIVO);
    assert.strictEqual(r.pagados, 5, "el estado real se cuenta igual");
    assert.strictEqual(r.pagadosDelSorteo, 2);
    assert.strictEqual(r.pagadosDeOtroSorteo, 3, "sin identidad ni evento no se atribuye al activo");
    assert.strictEqual(r.recaudo, 2000);
});

prueba("tabla vacía: sin división por cero", () => {
    const r = calcularResumenTabla([], 5000, ACTIVO);
    assert.deepStrictEqual([r.total, r.ocupacion, r.recaudo], [0, 0, 0]);
});

prueba("estático: el resumen usa el estado efectivo y el sorteo activo solo si es de este precio; el índice ordena", () => {
    const vista = fs.readFileSync(path.join(FRONT, "components/tablas/TablaPrecioView.tsx"), "utf8");
    assert.match(vista, /calcularResumenTabla\(numeros\.map\(n => \(\{ \.\.\.n, estado: estadoEfectivo\(n\) \}\)\), precio, coincidePrecio \? eventoActivo : null\)/);
    assert.match(vista, /<StatsBar resumen=\{resumen\} precio=\{precio\} \/>/);
    assert.match(vista, /subtitulo=\{personalizada \? "Diseño personalizado" : undefined\}/, "se conserva el cambio de «Diseños»");
    const indice = fs.readFileSync(path.join(FRONT, "components/tablas/IndiceTablas.tsx"), "utf8");
    assert.match(indice, /ordenarPorSorteoActivo\(tablas\.map/);
    const resumen = fs.readFileSync(path.join(FRONT, "services/tablas/resumenTabla.ts"), "utf8");
    assert.ok(!/supabase|fetch\(|\.update\(|\.insert\(/.test(resumen), "módulo puro: no lee ni escribe en la base");
});

for (const { n, fn } of pruebas) {
    try { fn(); ok++; console.log(`✅ ${n}`); }
    catch (e) { console.log(`❌ ${n}\n   ${e.message}`); }
}
console.log(`\n============================\nTOTAL: ${pruebas.length}  ✅ PASA: ${ok}  ❌ FALLA: ${pruebas.length - ok}\n============================`);
if (ok !== pruebas.length) process.exit(1);
