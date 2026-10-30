// ==========================================================================
// PRUEBAS (frontend) — UX-09 fase 1: caché compartida y sincronización.
//
//   1. lib/cache/almacen.ts: una lectura en curso se comparte; una respuesta
//      vieja que llega tarde no pisa una nueva; vaciar (cambio de usuario)
//      descarta lo que llegue de antes; invalidar renueva sin borrar.
//   2. lib/cache/sesion.ts: una validación de usuario por sesión; al cambiar
//      de usuario se vacía la caché y se avisa.
//   3. services/tablas/sincronizacionTabla.ts: corte de Realtime o de red ->
//      «perdida»; al reconectar, lectura inmediata y «sincronizada» solo si
//      no hubo otro corte entretanto; una lectura empezada antes del corte
//      nunca da los datos por buenos.
//
// Módulos REALES transpilados con el TypeScript del proyecto.
//
//     node frontend/tests/tablas/cacheSincronizacion.test.mjs
// ==========================================================================

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const FRONT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const ts = require(path.join(FRONT, "node_modules/typescript"));

// Supabase Auth falso: getUser cuenta llamadas; onAuthStateChange guarda el oyente.
const auth = {
    llamadas: 0,
    usuario: { id: "A" },
    oyente: null,
    getUser() { this.llamadas++; return Promise.resolve({ data: { user: this.usuario }, error: null }); },
    onAuthStateChange(fn) { this.oyente = fn; fn("INITIAL_SESSION", { user: { id: "A" } }); return { data: { subscription: { unsubscribe() {} } } }; }
};

function cargarTs(rutaAbs, cache = new Map()) {
    if (cache.has(rutaAbs)) return cache.get(rutaAbs).exports;
    const { outputText } = ts.transpileModule(fs.readFileSync(rutaAbs, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
    });
    const modulo = { exports: {} };
    cache.set(rutaAbs, modulo);
    const requerir = (spec) => {
        if (spec === "@/lib/supabase") return { supabase: { auth } };
        const base = spec.startsWith("@/") ? path.join(FRONT, spec.slice(2)) : path.resolve(path.dirname(rutaAbs), spec);
        for (const ext of [".ts", ".tsx"]) if (fs.existsSync(base + ext)) return cargarTs(base + ext, cache);
        return require(spec);
    };
    new Function("require", "module", "exports", outputText)(requerir, modulo, modulo.exports);
    return modulo.exports;
}

globalThis.window = globalThis.window || {};
const cache = new Map();
const almacen = cargarTs(path.join(FRONT, "lib/cache/almacen.ts"), cache);
const sesion = cargarTs(path.join(FRONT, "lib/cache/sesion.ts"), cache);
const { crearSincronizacion } = cargarTs(path.join(FRONT, "services/tablas/sincronizacionTabla.ts"), cache);

const dormir = (ms) => new Promise(r => setTimeout(r, ms));
function diferida() { let resolver, rechazar; const p = new Promise((a, b) => { resolver = a; rechazar = b; }); return { p, resolver, rechazar }; }

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

// ------------------------------------------------------------- almacén ---

prueba("almacén: dos peticiones iguales = UNA lectura; vigente = sin lectura", async () => {
    almacen.vaciar();
    let lecturas = 0;
    const cargador = async () => { lecturas++; await dormir(10); return { v: lecturas }; };
    const [a, b] = await Promise.all([almacen.cargar("u|x", cargador, { vigenciaMs: 1000 }), almacen.cargar("u|x", cargador, { vigenciaMs: 1000 })]);
    assert.strictEqual(lecturas, 1);
    assert.strictEqual(a, b);
    await almacen.cargar("u|x", cargador, { vigenciaMs: 1000 });
    assert.strictEqual(lecturas, 1, "vigente: no vuelve a leer");
    await almacen.cargar("u|x", cargador, { forzar: true });
    assert.strictEqual(lecturas, 2, "forzar: siempre lee");
});

prueba("almacén: una respuesta VIEJA que llega tarde no pisa la nueva", async () => {
    almacen.vaciar();
    const vieja = diferida(), nueva = diferida();
    const p1 = almacen.cargar("u|t", () => vieja.p, { forzar: true });
    const p2 = almacen.cargar("u|t", () => nueva.p, { forzar: true });
    nueva.resolver({ estado: "pagado" });
    await p2;
    vieja.resolver({ estado: "libre" });
    const r1 = await p1;
    assert.deepStrictEqual(almacen.leer("u|t"), { estado: "pagado" });
    assert.deepStrictEqual(r1, { estado: "pagado" }, "quien esperaba la vieja recibe lo más reciente");
});

prueba("almacén: vaciar descarta lo que llegue de antes y avisa a los suscritos", async () => {
    almacen.vaciar();
    const d = diferida();
    let avisos = 0;
    const quitar = almacen.suscribir("A|t", () => avisos++);
    const p = almacen.cargar("A|t", () => d.p);
    almacen.vaciar();
    assert.strictEqual(avisos, 1);
    d.resolver({ de: "A" });
    await p;
    assert.strictEqual(almacen.leer("A|t"), undefined, "nada del usuario anterior queda guardado");
    quitar();
});

prueba("almacén: invalidar renueva la próxima lectura y conserva los datos mientras", async () => {
    almacen.vaciar();
    let n = 0;
    await almacen.cargar("A|tablasCliente", async () => ++n, { vigenciaMs: 60000 });
    almacen.invalidar((c) => c.endsWith("|tablasCliente"));
    assert.strictEqual(almacen.leer("A|tablasCliente"), 1);
    assert.strictEqual(await almacen.cargar("A|tablasCliente", async () => ++n, { vigenciaMs: 60000 }), 2);
});

// -------------------------------------------------------------- sesión ---

prueba("sesión: una validación por sesión; cambio de usuario vacía y avisa", async () => {
    almacen.vaciar();
    auth.llamadas = 0;
    const [u1, u2] = await Promise.all([sesion.usuarioActual(), sesion.usuarioActual()]);
    await sesion.usuarioActual();
    assert.strictEqual(auth.llamadas, 1);
    assert.strictEqual(u1, u2);
    await almacen.cargar("A|t", async () => ({ privado: true }));
    auth.oyente("TOKEN_REFRESHED", { user: { id: "A" } });
    assert.ok(almacen.leer("A|t"), "renovar el token no borra nada");
    auth.usuario = { id: "B" };
    auth.oyente("SIGNED_IN", { user: { id: "B" } });
    assert.strictEqual(almacen.leer("A|t"), undefined, "datos de A borrados");
    assert.strictEqual((await sesion.usuarioActual()).id, "B");
    assert.strictEqual(auth.llamadas, 2);
    auth.oyente("SIGNED_OUT", null);
    auth.usuario = null;
    assert.strictEqual(await sesion.usuarioActual(), null);
    auth.usuario = { id: "A" };
    auth.oyente("SIGNED_IN", { user: { id: "A" } });
});

// ------------------------------------------------------- sincronización ---

function controlador(leer, extra = {}) {
    const estados = [];
    const s = crearSincronizacion({ canales: ["a", "b"], leer, alCambiar: (e) => estados.push(e), esperaInicialMs: 60, reintentoMs: 40, esperaMs: 5, ...extra });
    return { s, estados };
}

prueba("sincronización: solo con todos los canales conectados queda «sincronizada»", async () => {
    let lecturas = 0;
    const { s, estados } = controlador(async () => { lecturas++; });
    s.canal("a", "SUBSCRIBED");
    await dormir(10);
    assert.strictEqual(s.estado(), "validando");
    assert.strictEqual(lecturas, 0, "no se lee hasta tener todos los canales");
    s.canal("b", "SUBSCRIBED");
    await dormir(10);
    assert.strictEqual(lecturas, 1);
    assert.strictEqual(s.estado(), "sincronizada");
    assert.deepStrictEqual(estados, ["sincronizada"]);
    s.cerrar();
});

prueba("sincronización: corte de Realtime -> «perdida»; al volver, lectura nueva y «sincronizada»", async () => {
    let lecturas = 0;
    const { s, estados } = controlador(async () => { lecturas++; });
    s.canal("a", "SUBSCRIBED"); s.canal("b", "SUBSCRIBED");
    await dormir(10);
    s.canal("a", "CHANNEL_ERROR");
    assert.strictEqual(s.estado(), "perdida");
    s.canal("a", "SUBSCRIBED");
    await dormir(10);
    assert.strictEqual(lecturas, 2, "una lectura al reconectar");
    assert.deepStrictEqual(estados, ["sincronizada", "perdida", "validando", "sincronizada"]);
    s.cerrar();
});

prueba("sincronización: una lectura empezada ANTES de un corte no da los datos por buenos", async () => {
    const lecturas = [];
    const { s } = controlador(() => { const d = diferida(); lecturas.push(d); return d.p; });
    s.canal("a", "SUBSCRIBED"); s.canal("b", "SUBSCRIBED");
    await dormir(5);
    s.canal("b", "TIMED_OUT");
    lecturas[0].resolver();
    await dormir(5);
    assert.strictEqual(s.estado(), "perdida");
    s.canal("b", "SUBSCRIBED");
    await dormir(5);
    assert.strictEqual(lecturas.length, 2);
    assert.strictEqual(s.estado(), "validando", "hasta que termine la lectura nueva");
    lecturas[1].resolver();
    await dormir(5);
    assert.strictEqual(s.estado(), "sincronizada");
    s.cerrar();
});

prueba("sincronización: red caída -> «perdida»; red de vuelta con canales vivos -> lectura y «sincronizada»", async () => {
    let lecturas = 0;
    const { s } = controlador(async () => { lecturas++; });
    s.canal("a", "SUBSCRIBED"); s.canal("b", "SUBSCRIBED");
    await dormir(10);
    s.red(false);
    assert.strictEqual(s.estado(), "perdida");
    s.red(true);
    await dormir(10);
    assert.strictEqual(lecturas, 2);
    assert.strictEqual(s.estado(), "sincronizada");
    s.cerrar();
});

prueba("sincronización: la lectura al reconectar falla -> «perdida» y reintento automático", async () => {
    let lecturas = 0;
    const { s } = controlador(async () => { lecturas++; if (lecturas === 2) throw new Error("red"); });
    s.canal("a", "SUBSCRIBED"); s.canal("b", "SUBSCRIBED");
    await dormir(10);
    s.canal("a", "CLOSED"); s.canal("a", "SUBSCRIBED");
    await dormir(10);
    assert.strictEqual(s.estado(), "perdida");
    await dormir(60);
    assert.strictEqual(lecturas, 3);
    assert.strictEqual(s.estado(), "sincronizada");
    s.cerrar();
});

prueba("sincronización: Realtime que no conecta a tiempo -> se lee igual y queda «perdida»", async () => {
    let lecturas = 0;
    const { s } = controlador(async () => { lecturas++; });
    await dormir(80);
    assert.strictEqual(lecturas, 1, "se muestran los datos");
    assert.strictEqual(s.estado(), "perdida");
    s.canal("a", "SUBSCRIBED"); s.canal("b", "SUBSCRIBED");
    await dormir(10);
    assert.strictEqual(s.estado(), "sincronizada");
    s.cerrar();
});

prueba("sincronización: tras cerrar no avisa ni lee", async () => {
    let lecturas = 0;
    const { s, estados } = controlador(async () => { lecturas++; });
    s.cerrar();
    s.canal("a", "SUBSCRIBED"); s.canal("b", "SUBSCRIBED"); s.canal("a", "CLOSED");
    await dormir(80);
    assert.strictEqual(lecturas, 0);
    assert.deepStrictEqual(estados, []);
});

let ok = 0, falla = 0;
for (const { n, fn } of pruebas) {
    try { await fn(); ok++; console.log(`✅ ${n}`); }
    catch (e) { falla++; console.log(`❌ ${n}`); console.log("   ", e && e.stack); }
}
console.log(`\n============================\nTOTAL: ${ok + falla}  ✅ PASA: ${ok}  ❌ FALLA: ${falla}\n============================`);
process.exit(falla ? 1 : 0);
