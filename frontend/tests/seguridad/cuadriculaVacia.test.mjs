// ==========================================================================
// PRUEBAS (frontend) — tabla sin filas visibles en /tablas/:precio.
//
//   1. diagnosticar(): cada respuesta del backend (POST /tablas/:precio/
//      preparar) se muestra con su causa real; una RLS que oculta filas, una
//      migración pendiente o un error de lectura nunca se presentan como
//      "tabla vacía" ni sugieren reiniciar.
//   2. prepararCuadricula(): solo envía el precio (el cliente sale del token).
//   3. reiniciarTabla() con 0 filas visibles: el navegador ya no inserta
//      00-99; lo decide el backend y, si no se puede, falla con el motivo.
//   4. Estático: la vista ya no dice "Presiona Reiniciar".
//
// Servicios REALES transpilados con el TypeScript del proyecto; Supabase y
// fetch en memoria.
//
//     node frontend/tests/seguridad/cuadriculaVacia.test.mjs
// ==========================================================================

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const FRONT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const ts = require(path.join(FRONT, "node_modules/typescript"));

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const T5K = "5k_15k_reservas_2_cifras";

// ------------------------------------------------------- Supabase (fake) ---

const db = {};
const escrituras = [];

const supabase = {
    auth: { getSession: async () => ({ data: { session: { access_token: "jwt-A", user: { id: A } } } }) },
    from(tabla) {
        const q = { tabla, op: "select", filtros: [], contar: false, cabecera: false, datos: null };
        const b = {
            select(_c, opciones) { q.contar = !!opciones?.count; q.cabecera = !!opciones?.head; return b; },
            insert(x) { q.op = "insert"; q.datos = x; return b; },
            update(x) { q.op = "update"; q.datos = x; return b; },
            eq(c, v) { q.filtros.push([c, v]); return b; },
            order() { return b; },
            then(ok, ko) {
                const filas = db[tabla] || (db[tabla] = []);
                const coinciden = filas.filter(f => q.filtros.every(([c, v]) => f[c] === v));
                let res;
                if (q.op === "insert") { escrituras.push({ tabla, op: "insert" }); filas.push(...[].concat(q.datos)); res = { data: null, error: null }; }
                else if (q.op === "update") { escrituras.push({ tabla, op: "update" }); res = { data: null, error: null }; }
                else res = { data: q.cabecera ? null : coinciden, count: q.contar ? coinciden.length : null, error: null };
                return Promise.resolve(res).then(ok, ko);
            }
        };
        return b;
    }
};

// ----------------------------------------------------------- fetch (fake) ---

let respuestaBackend = null;
let alPreparar = () => {};
const peticiones = [];

globalThis.fetch = async (url, init = {}) => {
    peticiones.push({ url, init });
    if (respuestaBackend instanceof Error) throw respuestaBackend;
    alPreparar();
    return { json: async () => respuestaBackend };
};

// ------------------------------------------------- cargador de módulos TS ---

function cargarTs(rutaAbs, cache = new Map()) {
    if (cache.has(rutaAbs)) return cache.get(rutaAbs).exports;
    const { outputText } = ts.transpileModule(fs.readFileSync(rutaAbs, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
    });
    const modulo = { exports: {} };
    cache.set(rutaAbs, modulo);
    const requerir = (spec) => {
        if (spec === "@/lib/supabase") return { supabase };
        const base = spec.startsWith("@/") ? path.join(FRONT, spec.slice(2)) : path.resolve(path.dirname(rutaAbs), spec);
        for (const ext of [".ts", ".tsx"]) if (fs.existsSync(base + ext)) return cargarTs(base + ext, cache);
        return require(spec);
    };
    new Function("require", "module", "exports", outputText)(requerir, modulo, modulo.exports);
    return modulo.exports;
}

const cache = new Map();
const S = (p) => path.join(FRONT, "services/tablas", p);
const { prepararCuadricula, diagnosticar } = cargarTs(S("prepararCuadricula.ts"), cache);
const { reiniciarTabla } = cargarTs(S("reiniciarTabla.ts"), cache);
const { olvidarTablasCliente } = cargarTs(S("tablasCliente.ts"), cache);
const leer = (rel) => fs.readFileSync(path.join(FRONT, rel), "utf8");

const NUMEROS = Array.from({ length: 100 }, (_, i) => String(i).padStart(2, "0"));

function reiniciar() {
    for (const k of Object.keys(db)) delete db[k];
    olvidarTablasCliente();
    db.tablas_cliente = [];
    db.reservas_actividad = [];
    db[T5K] = [];
    escrituras.length = 0;
    peticiones.length = 0;
    alPreparar = () => {};
}

const NO_REINICIAR = /No uses «Reiniciar»/;

// --------------------------------------------------------------- pruebas ---

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

prueba("diagnóstico: cada causa con su mensaje; ninguna se presenta como 'tabla vacía'", () => {
    const casos = [
        [{ ok: false, motivo: "migracion_pendiente", estado: "vacia", filas: 0 }, /027/],
        [{ ok: false, motivo: "restriccion_unica", estado: "vacia", filas: 0 }, /033/],
        [{ ok: false, motivo: "parte_a_pendiente", estado: "vacia", filas: 0 }, /RLS, Parte A/],
        [{ ok: false, motivo: "error_lectura", codigo: "42501" }, /código 42501/],
        [{ ok: false, motivo: "sin_respuesta" }, /no respondió/]
    ];
    for (const [r, patron] of casos) {
        const d = diagnosticar(r, 0);
        assert.strictEqual(d.tipo, "bloqueada", r.motivo);
        assert.ok(patron.test(d.mensaje), `${r.motivo}: ${d.mensaje}`);
        assert.ok(NO_REINICIAR.test(d.mensaje), `${r.motivo}: no sugiere reiniciar`);
        assert.ok(!/está vacía/.test(d.titulo + d.mensaje), r.motivo);
    }
});

prueba("diagnóstico: la base tiene 100 filas pero la sesión no ve ninguna -> RLS/permisos, no 'vacía'", () => {
    const d = diagnosticar({ ok: true, estado: "completa", filas: 100, esperadas: 100 }, 0);
    assert.strictEqual(d.tipo, "bloqueada");
    assert.ok(/RLS/.test(d.mensaje) && /No es una tabla vacía/.test(d.mensaje), d.mensaje);
    assert.strictEqual(diagnosticar({ ok: true, estado: "completa", filas: 100, esperadas: 100 }, 100).tipo, "lista");
});

prueba("diagnóstico: cuadrícula incompleta o con filas de más -> se informa sin completar ni reiniciar", () => {
    const d = diagnosticar({ ok: true, estado: "incompleta", filas: 40, esperadas: 100 }, 0);
    assert.strictEqual(d.tipo, "bloqueada");
    assert.ok(/40 de 100/.test(d.mensaje) && /No se completa/.test(d.mensaje), d.mensaje);
    assert.strictEqual(diagnosticar({ ok: true, estado: "excedida", filas: 120, esperadas: 100 }, 120).tipo, "bloqueada");
});

prueba("prepararCuadricula: POST /api/tablas/preparar solo con el precio; sin respuesta -> motivo, no excepción", async () => {
    reiniciar();
    respuestaBackend = { ok: true, estado: "completa", filas: 100, esperadas: 100 };
    const r = await prepararCuadricula(5000);
    assert.strictEqual(r.estado, "completa");
    assert.strictEqual(peticiones[0].url, "/api/tablas/preparar");
    assert.strictEqual(peticiones[0].init.method, "POST");
    assert.deepStrictEqual(JSON.parse(peticiones[0].init.body), { precio: 5000 });
    respuestaBackend = new Error("red caída");
    assert.deepStrictEqual(await prepararCuadricula(5000), { ok: false, motivo: "sin_respuesta" });
});

prueba("reiniciarTabla con 0 filas visibles y migración pendiente: no inserta nada desde el navegador y falla con el motivo", async () => {
    reiniciar();
    respuestaBackend = { ok: false, motivo: "migracion_pendiente", estado: "vacia", filas: 0 };
    await assert.rejects(() => reiniciarTabla(5000, A), (e) => /027/.test(e.message) && NO_REINICIAR.test(e.message));
    assert.deepStrictEqual(escrituras, [], "ni INSERT ni UPDATE desde el navegador");
    assert.strictEqual(db[T5K].length, 0);
});

prueba("reiniciarTabla con 0 filas visibles y base lista: la cuadrícula la crea el backend; el navegador solo registra la actividad", async () => {
    reiniciar();
    respuestaBackend = { ok: true, estado: "completa", filas: 100, esperadas: 100, tabla: T5K };
    // Lo que haría el backend (027): las 100 filas del cliente.
    alPreparar = () => { db[T5K].push(...NUMEROS.map(numero => ({ usuario_id: A, numero, estado: "libre" }))); };
    assert.strictEqual(await reiniciarTabla(5000, A), true);
    assert.deepStrictEqual(escrituras.map(e => e.tabla), ["reservas_actividad"]);
    assert.strictEqual(db.reservas_actividad[0].detalle.accion, "creada");
});

prueba("reiniciarTabla con 0 filas visibles pero 100 en la base (RLS): error claro, sin escribir", async () => {
    reiniciar();
    respuestaBackend = { ok: true, estado: "completa", filas: 100, esperadas: 100, tabla: T5K };
    await assert.rejects(() => reiniciarTabla(5000, A), (e) => /RLS/.test(e.message));
    assert.deepStrictEqual(escrituras, []);
});

prueba("estático: la vista ya no pide 'Presiona Reiniciar' y usa el diagnóstico; la ruta solo reenvía el precio", () => {
    const vista = leer("components/tablas/TablaPrecioView.tsx");
    assert.ok(!/Presiona\s*<b>Reiniciar<\/b>/.test(vista));
    assert.ok(!/Esta tabla está vacía/.test(vista));
    assert.ok(/diagnostico\?\.mensaje/.test(vista));
    const reinicio = leer("services/tablas/reiniciarTabla.ts");
    assert.ok(!/\.insert\(/.test(reinicio), "el navegador no inserta la cuadrícula");
    const ruta = leer("app/api/tablas/preparar/route.ts");
    assert.ok(/cuerpo: \{\}/.test(ruta) && !/usuario/i.test(ruta.replace(/\/\/.*$/gm, "")), "no reenvía ningún usuario");
    assert.ok(/prepararCuadricula/.test(leer("hooks/useTablaPrecio.ts")));
});

// ------------------------------------------------------------- ejecución ---

let ok = 0, falla = 0;
for (const { n, fn } of pruebas) {
    try { await fn(); ok++; console.log(`✅ ${n}`); }
    catch (e) { falla++; console.log(`❌ ${n}`); console.log("   ", e && e.message); }
}
console.log(`\n============================\nTOTAL: ${ok + falla}  ✅ PASA: ${ok}  ❌ FALLA: ${falla}\n============================`);
process.exit(falla ? 1 : 0);
