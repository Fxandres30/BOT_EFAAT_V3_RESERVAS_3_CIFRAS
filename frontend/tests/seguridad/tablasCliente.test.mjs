// ==========================================================================
// PRUEBAS (frontend) — tablas por cliente en el panel.
//
//   1. services/tablas/tablasCliente.ts: configuración del cliente de la
//      sesión; sin migración 027 / sin inicializar / con error -> los
//      precios base; sin usuario -> nada.
//   2. Acciones reales del panel (marcarPagado, obtenerTabla) con DOS
//      clientes en la MISMA tabla física: cada uno solo toca su cuadrícula.
//   3. Estático: ningún servicio de tablas usa ya el mapa fijo; la
//      inicialización no envía ningún usuario.
//
// Supabase en memoria; servicios REALES transpilados con el TypeScript del
// proyecto. Las barreras reales son la RLS (Parte A + 027), probadas en
// backend/tests/seguridad/migracion027.test.js.
//
//     node frontend/tests/seguridad/tablasCliente.test.mjs
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
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const T5K = "5k_15k_reservas_2_cifras";

// ------------------------------------------------------- Supabase (fake) ---

const db = {};
let sinTabla027 = false;
const consultas = [];

const supabase = {
    from(tabla) {
        const q = { tabla, op: "select", filtros: [], datos: null, unico: false };
        consultas.push(q);
        const b = {
            select() { return b; },
            update(x) { q.op = "update"; q.datos = x; return b; },
            insert(x) { q.op = "insert"; q.datos = x; return b; },
            eq(c, v) { q.filtros.push([c, v]); return b; },
            order() { return b; },
            maybeSingle() { q.unico = true; return b; },
            then(ok, ko) {
                if (tabla === "tablas_cliente" && sinTabla027) {
                    return Promise.resolve({ data: null, error: { code: "PGRST205", message: "Could not find the table" } }).then(ok, ko);
                }
                const filas = db[tabla] || (db[tabla] = []);
                const coinciden = filas.filter(f => q.filtros.every(([c, v]) => f[c] === v));
                let res;
                if (q.op === "insert") { filas.push(...[].concat(q.datos)); res = { data: null, error: null }; }
                else if (q.op === "update") { coinciden.forEach(f => Object.assign(f, q.datos)); res = { data: q.unico ? (coinciden[0] || null) : coinciden, error: null }; }
                else res = { data: q.unico ? (coinciden[0] || null) : coinciden, error: null };
                return Promise.resolve(res).then(ok, ko);
            }
        };
        return b;
    }
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
const tc = cargarTs(S("tablasCliente.ts"), cache);
const { marcarPagado } = cargarTs(S("marcarPagado.ts"), cache);
const { obtenerTabla } = cargarTs(S("obtenerTabla.ts"), cache);
const leer = (rel) => fs.readFileSync(path.join(FRONT, rel), "utf8");

const fila = (usuario, precio, tabla, activa = true) => ({ usuario_id: usuario, precio, tabla_fisica: tabla, cifras: 2, cantidad: 100, activa });
const NUMEROS = Array.from({ length: 100 }, (_, i) => String(i).padStart(2, "0"));

function reiniciar() {
    tc.olvidarTablasCliente();
    sinTabla027 = false;
    consultas.length = 0;
    db.tablas_cliente = [];
    db.reservas_actividad = [];
    db[T5K] = [A, B].flatMap(u => NUMEROS.map(numero => ({ usuario_id: u, numero, estado: numero === "07" ? "reservado" : "libre" })));
}

// --------------------------------------------------------------- pruebas ---

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

prueba("sin usuario: ninguna tabla; sin 027 o sin inicializar: los 8 precios base", async () => {
    reiniciar();
    assert.deepStrictEqual(await tc.obtenerTablasCliente(null), []);
    assert.strictEqual(await tc.obtenerTablaConfigCliente(5000, null), null);
    sinTabla027 = true;
    assert.deepStrictEqual((await tc.obtenerTablasCliente(A)).map(c => c.precio), [1000, 1500, 2000, 3000, 5000, 7000, 10000, 15000]);
    tc.olvidarTablasCliente();
    sinTabla027 = false;
    assert.strictEqual((await tc.obtenerTablasCliente(B)).length, 8, "B sin filas propias");
});

prueba("con configuración propia: solo la del cliente (activas); la de otro no existe para él", async () => {
    reiniciar();
    db.tablas_cliente = [fila(A, 1000, "reservas_dos_cifras"), fila(A, 5000, T5K, false), fila(B, 9000, T5K)];
    assert.deepStrictEqual((await tc.obtenerTablasCliente(A)).map(c => c.precio), [1000]);
    assert.strictEqual(await tc.obtenerTablaConfigCliente(5000, A), null, "desactivada");
    assert.strictEqual(await tc.obtenerTablaConfigCliente(9000, A), null, "precio de B");
    assert.deepStrictEqual(await tc.obtenerTablaConfigCliente(9000, B), { tabla: T5K, cifras: 2, cantidad: 100 });
    const filtros = consultas.filter(q => q.tabla === "tablas_cliente").map(q => q.filtros);
    assert.ok(filtros.every(f => f.some(([c]) => c === "usuario_id")), "siempre filtra por el usuario");
});

prueba("caché por usuario: una lectura; olvidar la renueva", async () => {
    reiniciar();
    await tc.obtenerTablasCliente(A);
    await tc.obtenerTablasCliente(A);
    assert.strictEqual(consultas.filter(q => q.tabla === "tablas_cliente").length, 1);
    tc.olvidarTablasCliente(A);
    await tc.obtenerTablasCliente(A);
    assert.strictEqual(consultas.filter(q => q.tabla === "tablas_cliente").length, 2);
});

prueba("marcar pagado (A): solo la fila de A en la tabla física de su configuración", async () => {
    reiniciar();
    const antesB = JSON.stringify(db[T5K].filter(f => f.usuario_id === B));
    await marcarPagado({ precio: 5000, numero: "07", usuarioId: A, realizadoPor: "admin@a" });
    assert.strictEqual(db[T5K].find(f => f.usuario_id === A && f.numero === "07").estado, "pagado");
    assert.strictEqual(JSON.stringify(db[T5K].filter(f => f.usuario_id === B)), antesB, "el 07 de B sigue reservado");
});

prueba("obtenerTabla (B): sus 100 números, ninguno de A", async () => {
    reiniciar();
    const filas = await obtenerTabla(5000, B);
    assert.strictEqual(filas.length, 100);
    assert.ok(filas.every(f => f.usuario_id === B));
});

prueba("precio desactivado en la cuenta: las acciones no tocan nada", async () => {
    reiniciar();
    db.tablas_cliente = [fila(A, 1000, "reservas_dos_cifras"), fila(A, 5000, T5K, false)];
    const antes = JSON.stringify(db[T5K]);
    await assert.rejects(marcarPagado({ precio: 5000, numero: "07", usuarioId: A, realizadoPor: "x" }), /Tabla no encontrada/);
    assert.strictEqual(JSON.stringify(db[T5K]), antes);
});

prueba("estático: los servicios de tablas usan la configuración del cliente, no el mapa fijo", () => {
    for (const f of ["obtenerTabla.ts", "marcarPagado.ts", "bloquearNumero.ts", "liberarNumero.ts", "marcarEnProceso.ts", "reiniciarTabla.ts"]) {
        const src = leer(`services/tablas/${f}`);
        assert.ok(src.includes("await obtenerTablaConfigCliente(precio, usuarioId)"), f);
        assert.ok(!/obtenerTablaConfig\(/.test(src), `${f} sin el mapa fijo`);
    }
    assert.ok(leer("hooks/useTablaPrecio.ts").includes("obtenerTablaConfigCliente(precio, data.user.id)"));
    assert.ok(leer("app/tablas/page.tsx").includes("<IndiceTablas />") && !leer("app/tablas/page.tsx").includes("PRECIOS_VALIDOS"));
});

prueba("estático: la inicialización no envía ningún usuario (el backend usa el token)", () => {
    const servicio = leer("services/tablas/inicializarCliente.ts");
    assert.ok(servicio.includes('fetchConSesion("/api/tablas/inicializar", { method: "POST" })'));
    assert.ok(!/body:/.test(servicio));
    const proxy = leer("app/api/tablas/inicializar/route.ts");
    assert.ok(proxy.includes("cuerpo: {}") && !proxy.includes("leerCuerpo"));
    assert.ok(leer("components/layout/DashboardLayout/DashboardLayout.tsx").includes("inicializarCliente()"));
});

let ok = 0, falla = 0;
for (const { n, fn } of pruebas) {
    try { await fn(); ok++; console.log(`✅ ${n}`); }
    catch (e) { falla++; console.log(`❌ ${n}`); console.log("   ", e && e.message); }
}
console.log(`\n============================\nTOTAL: ${ok + falla}  ✅ PASA: ${ok}  ❌ FALLA: ${falla}\n============================`);
process.exit(falla ? 1 : 0);
