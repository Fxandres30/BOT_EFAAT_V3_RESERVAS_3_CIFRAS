// ==========================================================================
// PRUEBAS (frontend) — caché del índice de Reservas (estado de sorteos).
//
//   1. Al volver (nuevo montaje) los datos siguen en la caché: se pintan al
//      instante, sin «Consultando sorteo…».
//   2. Dos montajes seguidos (StrictMode, ida y vuelta inmediata) = UNA
//      lectura; pasada la vigencia se revalida en segundo plano sin borrar.
//   3. Si una fuente falla, se conserva su último dato válido, `fallo` lo
//      dice y la lectura no cuenta como vigente (se reintenta). Sin dato
//      previo sigue en null: nada inventado.
//   4. Una operación que modifica (POST/PUT/PATCH/DELETE de apiSorteos), aun
//      fallida, deja el índice como no vigente; un GET no.
//   5. Cambio de usuario (vaciar): nada del anterior queda visible.
//
// Módulos REALES (almacen, apiSorteos, indiceSorteos) transpilados con el
// TypeScript del proyecto; solo se simulan Supabase Auth y fetch.
//
//     node frontend/tests/tablas/indiceSorteosCache.test.mjs
// ==========================================================================

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const FRONT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const ts = require(path.join(FRONT, "node_modules/typescript"));

const supabase = {
    auth: {
        getSession: () => Promise.resolve({ data: { session: { access_token: "t" } } }),
        getUser: () => Promise.resolve({ data: { user: { id: "A" } }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
    }
};

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

// Backend simulado: cuenta peticiones por ruta y responde lo configurado.
const servidor = {
    peticiones: [],
    activos: { ok: true, data: [{ id: "e1" }] },
    gestion: { ok: true, data: [{ id: "s1" }] },
    listar: { ok: true, data: [{ id: "s1" }] },
    caido: false,
    reset() { this.peticiones = []; this.caido = false; }
};

globalThis.fetch = async (url, init) => {
    const ruta = String(url).replace("/api/sorteos", "");
    servidor.peticiones.push(`${init.method} ${ruta}`);
    await new Promise(r => setTimeout(r, 5));
    if (servidor.caido) throw new Error("sin red");
    const cuerpo = ruta === "/activos" ? servidor.activos
        : ruta === "/gestion" ? servidor.gestion
        : ruta === "" && init.method === "GET" ? servidor.listar
        : { ok: true, data: {} };
    return { status: cuerpo.ok ? 200 : 500, json: async () => cuerpo };
};

const cache = new Map();
const almacen = cargarTs(path.join(FRONT, "lib/cache/almacen.ts"), cache);
const { apiSorteos } = cargarTs(path.join(FRONT, "services/sorteos/apiSorteos.ts"), cache);
const indice = cargarTs(path.join(FRONT, "services/tablas/indiceSorteos.ts"), cache);

const lecturas = () => servidor.peticiones.filter(p => p === "GET /activos").length;

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

prueba("al volver, los datos siguen en la caché (sin «Consultando sorteo…»)", async () => {
    almacen.vaciar(); servidor.reset();
    await indice.cargarIndiceSorteos("A");
    // «Salir» de Reservas no toca la caché; «volver» lee de forma síncrona.
    assert.strictEqual(indice.ultimoUsuarioIndice(), "A");
    const pintado = indice.leerIndiceSorteos(indice.ultimoUsuarioIndice());
    assert.deepStrictEqual(pintado, { activos: [{ id: "e1" }], programados: [{ id: "s1" }], fallo: false });
});

prueba("dos montajes seguidos = UNA lectura; forzar (Realtime/60 s) siempre lee", async () => {
    almacen.vaciar(); servidor.reset();
    await Promise.all([indice.cargarIndiceSorteos("A"), indice.cargarIndiceSorteos("A")]);
    assert.strictEqual(lecturas(), 1);
    await indice.cargarIndiceSorteos("A");
    assert.strictEqual(lecturas(), 1, "vigente: volver enseguida no repite la consulta");
    await indice.cargarIndiceSorteos("A", { forzar: true });
    assert.strictEqual(lecturas(), 2);
});

prueba("revalidación en segundo plano: los datos anteriores siguen visibles mientras", async () => {
    almacen.vaciar(); servidor.reset();
    await indice.cargarIndiceSorteos("A");
    servidor.activos = { ok: true, data: [{ id: "e2" }] };
    const p = indice.cargarIndiceSorteos("A", { forzar: true });
    assert.deepStrictEqual(indice.leerIndiceSorteos("A").activos, [{ id: "e1" }], "no se vacía durante la lectura");
    await p;
    assert.deepStrictEqual(indice.leerIndiceSorteos("A").activos, [{ id: "e2" }]);
    servidor.activos = { ok: true, data: [{ id: "e1" }] };
});

prueba("fallo de conexión: se conservan los últimos datos válidos y se reintenta", async () => {
    almacen.vaciar(); servidor.reset();
    await indice.cargarIndiceSorteos("A");
    servidor.caido = true;
    const r = await indice.cargarIndiceSorteos("A", { forzar: true });
    assert.deepStrictEqual(r.activos, [{ id: "e1" }]);
    assert.deepStrictEqual(r.programados, [{ id: "s1" }]);
    assert.strictEqual(r.fallo, true);
    servidor.caido = false;
    const antes = lecturas();
    await indice.cargarIndiceSorteos("A");
    assert.strictEqual(lecturas(), antes + 1, "una lectura fallida no queda como vigente");
    assert.strictEqual(indice.leerIndiceSorteos("A").fallo, false);
});

prueba("fallo sin dato previo: null (no se inventa nada)", async () => {
    almacen.vaciar(); servidor.reset();
    servidor.caido = true;
    const r = await indice.cargarIndiceSorteos("A");
    assert.strictEqual(r.activos, null);
    assert.strictEqual(r.programados, null);
    assert.strictEqual(r.fallo, true);
    servidor.caido = false;
});

prueba("operación que modifica (aun fallida) invalida el índice; GET no", async () => {
    almacen.vaciar(); servidor.reset();
    await indice.cargarIndiceSorteos("A");
    await apiSorteos.grupos();
    await indice.cargarIndiceSorteos("A");
    assert.strictEqual(lecturas(), 1, "un GET no invalida");
    await apiSorteos.cancelar("s1");
    await indice.cargarIndiceSorteos("A");
    assert.strictEqual(lecturas(), 2, "tras cancelar se revalida");
    servidor.caido = true;
    await apiSorteos.accionEvento("e1", { accion: "cerrar" });
    servidor.caido = false;
    await indice.cargarIndiceSorteos("A");
    assert.strictEqual(lecturas(), 3, "también tras una operación fallida");
});

prueba("cambio de usuario: nada del anterior queda visible", async () => {
    almacen.vaciar(); servidor.reset();
    await indice.cargarIndiceSorteos("A");
    almacen.vaciar();
    assert.strictEqual(indice.leerIndiceSorteos("A"), undefined);
    assert.strictEqual(indice.leerIndiceSorteos("B"), undefined);
});

let fallos = 0;
for (const { n, fn } of pruebas) {
    try { await fn(); console.log(`  ok  ${n}`); }
    catch (e) { fallos++; console.log(`  FALLO  ${n}\n        ${e.message}`); }
}
console.log(`\n${pruebas.length - fallos}/${pruebas.length} correctas`);
process.exit(fallos ? 1 : 0);
