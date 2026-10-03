// ==========================================================================
// PRUEBAS (frontend) — tipo "disponibilidad_agotada" en el panel de
// Mensajes/Plantillas.
//
// El frontend no tiene runner de tests: este script carga los servicios
// TypeScript REALES del panel (services/mensajes/plantillas.ts,
// tiposMensaje.ts, plantillasBase.ts) transpilándolos con el TypeScript del
// propio proyecto, y sustituye solo "@/lib/supabase" por un Supabase en
// memoria con DOS tenants. Sin dependencias nuevas.
//
//     node frontend/tests/mensajes/plantillasAgotado.test.mjs
// ==========================================================================

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const FRONT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const ts = require(path.join(FRONT, "node_modules/typescript"));

// ------------------------------------------------------- Supabase (fake) ---

const db = { plantillas_mensaje: [] };
let secuencia = 0;

const supabase = {
    from(tabla) {
        const filtros = [];
        let operacion = "select";
        let datos = null;
        let unico = false;
        let contar = false;
        const b = {
            select(_c, opciones) { if (opciones?.count) contar = true; return b; },
            insert(x) { operacion = "insert"; datos = Array.isArray(x) ? x : [x]; return b; },
            update(x) { operacion = "update"; datos = x; return b; },
            delete() { operacion = "delete"; return b; },
            eq(c, v) { filtros.push([c, v]); return b; },
            order() { return b; },
            single() { unico = true; return b; },
            maybeSingle() { unico = true; return b; },
            then(ok, ko) {
                const filas = db[tabla] || (db[tabla] = []);
                const coinciden = filas.filter(f => filtros.every(([c, v]) => f[c] === v));
                let res;
                if (operacion === "insert") {
                    const nuevas = datos.map(d => ({ id: `id-${++secuencia}`, ...d }));
                    filas.push(...nuevas);
                    res = { data: unico ? nuevas[0] : nuevas, error: null };
                } else if (operacion === "update") {
                    coinciden.forEach(f => Object.assign(f, datos));
                    res = { data: unico ? coinciden[0] : coinciden, error: null };
                } else if (operacion === "delete") {
                    db[tabla] = filas.filter(f => !coinciden.includes(f));
                    res = { data: null, error: null };
                } else {
                    res = { data: unico ? (coinciden[0] || null) : coinciden, error: null, count: contar ? coinciden.length : undefined };
                }
                return Promise.resolve(res).then(ok, ko);
            }
        };
        return b;
    }
};

// ------------------------------------------------- cargador de módulos TS ---

function cargarTs(rutaAbs, fuente = fs.readFileSync(rutaAbs, "utf8"), cache = new Map()) {

    if (cache.has(rutaAbs)) return cache.get(rutaAbs).exports;

    const { outputText } = ts.transpileModule(fuente, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
    });

    const modulo = { exports: {} };
    cache.set(rutaAbs, modulo);

    const requerir = (spec) => {
        if (spec === "@/lib/supabase") return { supabase };
        const base = spec.startsWith("@/") ? path.join(FRONT, spec.slice(2)) : path.resolve(path.dirname(rutaAbs), spec);
        for (const ext of [".ts", ".tsx"]) {
            if (fs.existsSync(base + ext)) return cargarTs(base + ext, undefined, cache);
        }
        return require(spec);
    };

    new Function("require", "module", "exports", outputText)(requerir, modulo, modulo.exports);

    return modulo.exports;

}

const RUTA = (p) => path.join(FRONT, "services/mensajes", p);

const plantillas = cargarTs(RUTA("plantillas.ts"));
const { TIPOS_MENSAJE, obtenerTipoMensaje } = cargarTs(RUTA("tiposMensaje.ts"));
const { obtenerPlantillasBase } = cargarTs(RUTA("plantillasBase.ts"));

// Versión de plantillasBase.ts en HEAD (antes del cambio), para comprobar
// que las plantillas base de "disponibilidad" no cambiaron.
const baseHead = cargarTs(
    RUTA("plantillasBase.head.ts"),
    execSync("git show HEAD:frontend/services/mensajes/plantillasBase.ts", { cwd: FRONT, encoding: "utf8" })
);
const tiposHead = cargarTs(
    RUTA("tiposMensaje.head.ts"),
    execSync("git show HEAD:frontend/services/mensajes/tiposMensaje.ts", { cwd: FRONT, encoding: "utf8" })
);

const A = "tenant-A";
const B = "tenant-B";
const TIPO = "disponibilidad_agotada";

function reiniciar() {
    db.plantillas_mensaje = [
        // las de "disponibilidad" ya existentes del tenant A
        { id: "d1", usuario_id: A, tipo_respuesta: "disponibilidad", nombre: "Clásico", contenido: "🎲 NÚMEROS DISPONIBLES {{numeros_disponibles}}", habilitada: true, orden: 0 },
        { id: "d2", usuario_id: A, tipo_respuesta: "disponibilidad", nombre: "Corto", contenido: "⚡ DISPONIBLES {{numeros_disponibles}}", habilitada: false, orden: 1 }
    ];
}

const instantanea = () => JSON.stringify(db.plantillas_mensaje.filter(p => p.tipo_respuesta === "disponibilidad"));

// --------------------------------------------------------------- pruebas ---

const pruebas = [];
const prueba = (nombre, fn) => pruebas.push({ nombre, fn });

prueba("catálogo: 'disponibilidad_agotada' es un tipo soportado de Consultas, sin {{numeros_disponibles}}", () => {

    const tipo = obtenerTipoMensaje(TIPO);
    assert.ok(tipo);
    assert.strictEqual(tipo.soportado, true);
    assert.strictEqual(tipo.categoria, "Consultas");
    assert.ok(!tipo.variables.some(v => v.variable === "numeros_disponibles"));
    assert.strictEqual(TIPOS_MENSAJE.filter(t => t.id === TIPO).length, 1);

});

prueba("catálogo: la entrada 'disponibilidad' y el resto de tipos quedaron idénticos", () => {

    const sinNuevo = TIPOS_MENSAJE.filter(t => t.id !== TIPO);
    assert.deepStrictEqual(sinNuevo, tiposHead.TIPOS_MENSAJE);

});

prueba("plantillas base de agotado: sin {{numeros_disponibles}} y solo con variables del tipo", () => {

    const base = obtenerPlantillasBase(TIPO);
    const permitidas = new Set(obtenerTipoMensaje(TIPO).variables.map(v => v.variable));
    assert.ok(base.length >= 1);
    for (const p of base) {
        assert.ok(!/numeros_disponibles/.test(p.contenido));
        for (const [, v] of p.contenido.matchAll(/\{\{\s*(\w+)/g)) assert.ok(permitidas.has(v), `variable ${v} no pertenece al tipo`);
    }

});

prueba("plantillas base de 'disponibilidad' (y de todos los demás tipos) intactas", () => {

    for (const t of tiposHead.TIPOS_MENSAJE) {
        assert.deepStrictEqual(obtenerPlantillasBase(t.id), baseHead.obtenerPlantillasBase(t.id), t.id);
    }

});

prueba("1. listar plantillas de agotado (solo del tenant y del tipo)", async () => {

    reiniciar();
    await plantillas.crearPlantilla({ usuario_id: A, tipo_respuesta: TIPO, nombre: "A1", estilo: "x", contenido: "🚫 A1", variables: {}, habilitada: true, orden: 0 });
    await plantillas.crearPlantilla({ usuario_id: B, tipo_respuesta: TIPO, nombre: "B1", estilo: "x", contenido: "🚫 B1", variables: {}, habilitada: true, orden: 0 });

    const { data } = await plantillas.listarPlantillas(A, TIPO);
    assert.deepStrictEqual(data.map(p => p.nombre), ["A1"]);

});

prueba("2. crear plantilla -> se guarda con tipo_respuesta 'disponibilidad_agotada'", async () => {

    reiniciar();
    const { data } = await plantillas.crearPlantillaVacia(A, TIPO, 0);
    const fila = db.plantillas_mensaje.find(p => p.id === data.id);
    assert.strictEqual(fila.tipo_respuesta, TIPO);
    assert.strictEqual(fila.usuario_id, A);

});

prueba("3. editar plantilla", async () => {

    reiniciar();
    const { data } = await plantillas.crearPlantillaVacia(A, TIPO, 0);
    await plantillas.actualizarPlantilla(data.id, { contenido: "🚫 *NÚMEROS AGOTADOS*\n\nFamilia, ya no quedan numeritos. ❤️" });
    assert.match(db.plantillas_mensaje.find(p => p.id === data.id).contenido, /ya no quedan numeritos/);

});

prueba("4-5. activar y desactivar", async () => {

    reiniciar();
    const { data } = await plantillas.crearPlantillaVacia(A, TIPO, 0);
    await plantillas.alternarHabilitada(data.id, false);
    assert.strictEqual(db.plantillas_mensaje.find(p => p.id === data.id).habilitada, false);
    await plantillas.alternarHabilitada(data.id, true);
    assert.strictEqual(db.plantillas_mensaje.find(p => p.id === data.id).habilitada, true);

});

prueba("6. eliminar -> política existente (borrado físico)", async () => {

    reiniciar();
    const { data } = await plantillas.crearPlantillaVacia(A, TIPO, 0);
    await plantillas.eliminarPlantilla(data.id);
    assert.ok(!db.plantillas_mensaje.some(p => p.id === data.id));

});

prueba("7. siembra inicial del tipo: crea las base con el tipo correcto y no re-siembra", async () => {

    reiniciar();
    const r1 = await plantillas.sembrarPlantillasIniciales(A, TIPO);
    const filas = db.plantillas_mensaje.filter(p => p.tipo_respuesta === TIPO);
    assert.strictEqual(filas.length, obtenerPlantillasBase(TIPO).length);
    assert.ok(filas.every(p => p.usuario_id === A && p.habilitada === true));
    assert.ok(r1.creadas > 0);
    const r2 = await plantillas.sembrarPlantillasIniciales(A, TIPO);
    assert.strictEqual(r2.creadas, 0);

});

prueba("8. aislamiento por tenant: B no ve ni modifica las de A", async () => {

    reiniciar();
    await plantillas.sembrarPlantillasIniciales(A, TIPO);
    const deB = await plantillas.listarPlantillas(B, TIPO);
    assert.deepStrictEqual(deB.data, []);
    await plantillas.sembrarPlantillasIniciales(B, TIPO);
    const deA = (await plantillas.listarPlantillas(A, TIPO)).data;
    assert.ok(deA.every(p => p.usuario_id === A));

});

prueba("9. las plantillas de 'disponibilidad' siguen intactas tras todas las operaciones de agotado", async () => {

    reiniciar();
    const antes = instantanea();
    await plantillas.sembrarPlantillasIniciales(A, TIPO);
    const { data } = await plantillas.crearPlantillaVacia(A, TIPO, 9);
    await plantillas.actualizarPlantilla(data.id, { contenido: "x" });
    await plantillas.alternarHabilitada(data.id, false);
    await plantillas.eliminarPlantilla(data.id);
    assert.strictEqual(instantanea(), antes);

});

let ok = 0;
let falla = 0;

for (const { nombre, fn } of pruebas) {
    try {
        await fn();
        ok++;
        console.log(`✅ ${nombre}`);
    } catch (err) {
        falla++;
        console.log(`❌ ${nombre}`);
        console.log(err?.stack || err);
    }
}

console.log("\n============================");
console.log(`TOTAL: ${ok + falla}  ✅ PASA: ${ok}  ❌ FALLA: ${falla}`);
console.log("============================");

process.exit(falla ? 1 : 0);
