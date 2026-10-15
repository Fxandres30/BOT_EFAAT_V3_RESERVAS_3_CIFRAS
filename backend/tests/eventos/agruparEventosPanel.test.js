// ==========================================================================
// PRUEBAS — el panel muestra UNA tarjeta por sorteo real aunque se haya
// publicado en varios grupos (una fila de eventos_bot por grupo).
//
// Se prueba el código REAL del panel (frontend/components/eventos/
// agruparEventos.ts), transpilado con el TypeScript del propio frontend.
//
//     node backend/tests/eventos/agruparEventosPanel.test.js
// ==========================================================================

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const FRONTEND = path.resolve(__dirname, "../../../frontend");
const ts = require(path.join(FRONTEND, "node_modules/typescript"));

function cargarTs(archivo) {
    const fuente = fs.readFileSync(archivo, "utf8");
    const { outputText } = ts.transpileModule(fuente, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
    const m = new Module(archivo, module);
    m.filename = archivo;
    m._compile(outputText, archivo);
    return m.exports;
}

const { agruparEventos, claveEvento } = cargarTs(path.join(FRONTEND, "components/eventos/agruparEventos.ts"));
const { faseDe } = cargarTs(path.join(FRONTEND, "components/eventos/modalidad.ts"));
const { claveSorteo } = require("../../bot/funciones/eventos/sorteoReal");

const fila = (id, extra = {}) => ({
    id, usuario_id: "cliente-A", identidad_evento_real: "manizales-2026-10-14", nombre_evento: "Lotería de Manizales",
    grupo_id: `${id}@g.us`, grupo_nombre: `Grupo ${id}`, activo: true, abierto: true, estado: "abierto",
    hora_cierre: "22:26", reservados: 40, pagados: 30, pendientes: 10, libres: 60,
    actualizado_en: "2026-10-14T20:00:00Z", ...extra
});

const pruebas = [];
const prueba = (nombre, fn) => pruebas.push({ nombre, fn });

prueba("1. un sorteo en 3 grupos -> UNA tarjeta con sus 3 grupos", () => {
    const r = agruparEventos([fila("g1"), fila("g2", { abierto: false }), fila("g3")]);
    assert.strictEqual(r.length, 1);
    assert.deepStrictEqual(r[0].grupos.map(g => g.grupo_nombre), ["Grupo g1", "Grupo g2", "Grupo g3"]);
    assert.deepStrictEqual(r[0].grupos.map(g => g.abierto), [true, false, true], "se ve el estado de cada grupo");
    assert.strictEqual(r[0].reservados, 40, "contadores del sorteo, NO sumados (no 120)");
    assert.strictEqual(r[0].nombre_evento, "Lotería de Manizales");
});

prueba("2. dos sorteos realmente distintos (otra identidad) siguen separados aunque compartan grupo, fecha y hora", () => {
    const r = agruparEventos([fila("g1"), fila("g1b", { grupo_id: "g1@g.us", identidad_evento_real: "otro-sorteo", nombre_evento: "Otro" })]);
    assert.strictEqual(r.length, 2);
});

prueba("3. clientes distintos con la misma identidad nunca se mezclan", () => {
    const r = agruparEventos([fila("g1"), fila("g2", { usuario_id: "cliente-B" })]);
    assert.strictEqual(r.length, 2);
    assert.deepStrictEqual(r.map(e => e.usuario_id), ["cliente-A", "cliente-B"]);
});

prueba("4. filas sin identidad (anteriores a la 015) no se agrupan entre sí", () => {
    const r = agruparEventos([fila("g1", { identidad_evento_real: null }), fila("g2", { identidad_evento_real: null })]);
    assert.strictEqual(r.length, 2);
});

prueba("5. misma clave que el backend (worker/cierre)", () => {
    for (const f of [fila("g1"), fila("g2", { identidad_evento_real: null }), fila("g3", { usuario_id: null })]) {
        assert.strictEqual(claveEvento(f), claveSorteo(f));
    }
});

prueba("6. sorteo con un grupo ya cerrado y otro activo: sigue ACTIVO; datos de la fila activa", () => {
    const r = agruparEventos([
        fila("g1", { activo: false, estado: "cerrado", abierto: false, reservados: 5, actualizado_en: "2026-10-14T21:00:00Z" }),
        fila("g2", { reservados: 41 })
    ]);
    assert.strictEqual(r.length, 1);
    assert.strictEqual(faseDe(r[0]), "activo");
    assert.strictEqual(r[0].reservados, 41);
    assert.strictEqual(r[0].estado, "abierto");
});

prueba("7. todos los grupos cerrados -> una sola tarjeta en Resultados", () => {
    const r = agruparEventos([1, 2, 3].map(i => fila(`g${i}`, { activo: false, abierto: false, estado: "cerrado" })));
    assert.strictEqual(r.length, 1);
    assert.strictEqual(faseDe(r[0]), "finalizado");
    assert.strictEqual(r[0].grupos.length, 3);
});

prueba("8. no modifica los datos recibidos y conserva el orden de la consulta", () => {
    const entrada = [fila("x", { identidad_evento_real: "b" }), fila("g1"), fila("y", { identidad_evento_real: "b" })];
    const copia = JSON.stringify(entrada);
    const r = agruparEventos(entrada);
    assert.strictEqual(JSON.stringify(entrada), copia);
    assert.deepStrictEqual(r.map(e => e.identidad_evento_real), ["b", "manizales-2026-10-14"]);
});

let ok = 0;
let falla = 0;
for (const { nombre, fn } of pruebas) {
    try { fn(); ok++; console.log(`✅ ${nombre}`); } catch (err) { falla++; console.log(`❌ ${nombre}\n${err.stack}`); }
}
console.log(`\n============================\nTOTAL: ${ok + falla}  ✅ PASA: ${ok}  ❌ FALLA: ${falla}\n============================`);
process.exit(falla ? 1 : 0);
