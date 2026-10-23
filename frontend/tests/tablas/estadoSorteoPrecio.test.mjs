// ==========================================================================
// PRUEBAS (frontend) — Reservas: estado del sorteo en cada tarjeta de precio
// (services/tablas/estadoSorteoPrecio.ts, módulo puro: sin red ni Supabase).
//
// Comprueba que el estado sale de eventos_bot (activos) y de
// sorteos_programados según valor + tabla física, que un borrador no cuenta
// como programado, que un fallo de fuente no se muestra como «sin sorteo» y
// que sorteos distintos no se mezclan.
//
//     node frontend/tests/tablas/estadoSorteoPrecio.test.mjs
// ==========================================================================

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const FRONT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const ts = require(path.join(FRONT, "node_modules/typescript"));

// Carga un .ts resolviendo sus imports relativos a otros .ts.
function cargarTs(rutaAbs) {

    const { outputText } = ts.transpileModule(fs.readFileSync(rutaAbs, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
    });

    const requerir = (id) => id.startsWith(".") ? cargarTs(path.resolve(path.dirname(rutaAbs), `${id}.ts`)) : require(id);

    const modulo = { exports: {} };
    new Function("module", "exports", "require", outputText)(modulo, modulo.exports, requerir);

    return modulo.exports;

}

const { estadoSorteoPrecio } = cargarTs(path.join(FRONT, "services/tablas/estadoSorteoPrecio.ts"));

let total = 0;
function prueba(nombre, fn) { fn(); total++; console.log(`✅ ${nombre}`); }

const AHORA = new Date("2026-10-23T15:00:00-05:00");

const activo = (o = {}) => ({ id: "ev1", valor: 5000, tabla: "tabla_5000", nombre: "Lotería de Bogotá", sorteo_programado_id: null, grupos: [{ grupo_id: "g1" }], ...o });
const sorteo = (o = {}) => ({
    id: "s1", estado: "programado", tabla: "tabla_5000", publicar_en: "2026-10-23T18:30:00-05:00",
    ...o, config: { valor: 5000, nombre: "Antioqueñita", hora_fin: "22:00", ...(o.config || {}) }
});
const calc = (o) => estadoSorteoPrecio({ precio: 5000, tabla: "tabla_5000", activos: [], programados: [], ahora: AHORA, ...o });
const estados = (r) => r.map(e => e.estado);

prueba("sin activos ni programados -> sin_sorteo", () => {
    assert.deepStrictEqual(estados(calc({})), ["sin_sorteo"]);
});

prueba("activo del precio y su tabla -> SORTEO ACTIVO con nombre y grupos", () => {
    const r = calc({ activos: [activo({ grupos: [{}, {}] })] });
    assert.deepStrictEqual(estados(r), ["activo"]);
    assert.strictEqual(r[0].nombre, "Lotería de Bogotá");
    assert.strictEqual(r[0].grupos, 2);
});

prueba("activo de otro valor o de otra tabla física no cuenta", () => {
    assert.deepStrictEqual(estados(calc({ activos: [activo({ valor: 3000 })] })), ["sin_sorteo"]);
    assert.deepStrictEqual(estados(calc({ activos: [activo({ tabla: "tabla_3000" })] })), ["sin_sorteo"]);
});

prueba("programado futuro -> PROGRAMADO con la fecha guardada", () => {
    const r = calc({ programados: [sorteo()] });
    assert.deepStrictEqual(estados(r), ["programado"]);
    assert.strictEqual(r[0].nombre, "Antioqueñita");
    assert.strictEqual(r[0].publicarEn.toISOString(), "2026-10-23T23:30:00.000Z");
});

prueba("borrador y cancelado no son programados; publicado sin evento activo ya cerró", () => {
    const r = calc({ programados: [sorteo({ estado: "borrador" }), sorteo({ id: "s2", estado: "cancelado" }), sorteo({ id: "s3", estado: "publicado" })] });
    assert.deepStrictEqual(estados(r), ["sin_sorteo"]);
});

prueba("programado de otro precio no se mezcla", () => {
    assert.deepStrictEqual(estados(calc({ programados: [sorteo({ config: { valor: 2000 } })] })), ["sin_sorteo"]);
});

prueba("fallido aún por jugarse -> REQUIERE REVISIÓN; ya jugado -> no", () => {
    assert.deepStrictEqual(estados(calc({ programados: [sorteo({ estado: "fallido" })] })), ["revision"]);
    const viejo = sorteo({ estado: "fallido", publicar_en: "2026-10-20T10:00:00-05:00", config: { hora_fin: "14:00" } });
    assert.deepStrictEqual(estados(calc({ programados: [viejo] })), ["sin_sorteo"]);
});

prueba("publicado parcial con su evento activo -> activo con aviso, sin duplicar", () => {
    const r = calc({ activos: [activo({ sorteo_programado_id: "s1" })], programados: [sorteo({ estado: "publicado_parcial" })] });
    assert.deepStrictEqual(estados(r), ["activo"]);
    assert.match(r[0].motivo, /no se publicaron/);
});

prueba("activo + siguiente programado: se muestran por separado", () => {
    const r = calc({ activos: [activo()], programados: [sorteo({ config: { fecha_sorteo: "2026-10-24" } })] });
    assert.deepStrictEqual(estados(r), ["activo", "programado"]);
    assert.notStrictEqual(r[0].clave, r[1].clave);
});

prueba("dos sorteos activos distintos del mismo precio no se mezclan", () => {
    const r = calc({ activos: [activo(), activo({ id: "ev2", nombre: "Chontico" })] });
    assert.deepStrictEqual(r.map(e => e.nombre), ["Lotería de Bogotá", "Chontico"]);
});

prueba("programados ordenados por fecha de publicación", () => {
    const r = calc({ programados: [sorteo({ id: "tarde", publicar_en: "2026-10-24T09:00:00-05:00" }), sorteo({ id: "pronto" })] });
    assert.deepStrictEqual(r.map(e => e.clave), ["sorteo:pronto", "sorteo:tarde"]);
});

prueba("programado vencido conserva su fecha real (la vista no cuenta en negativo)", () => {
    const r = calc({ programados: [sorteo({ publicar_en: "2026-10-23T14:00:00-05:00" })] });
    assert.ok(r[0].publicarEn < AHORA);
});

prueba("fuente de activos caída -> no_disponible (nunca «sin sorteo»)", () => {
    assert.deepStrictEqual(estados(calc({ activos: null, programados: [sorteo()] })), ["no_disponible"]);
});

prueba("listado de programados caído: muestra activos; sin activos -> no_disponible", () => {
    assert.deepStrictEqual(estados(calc({ activos: [activo()], programados: null })), ["activo"]);
    assert.deepStrictEqual(estados(calc({ programados: null })), ["no_disponible"]);
});

console.log(`\n${total} pruebas OK`);
