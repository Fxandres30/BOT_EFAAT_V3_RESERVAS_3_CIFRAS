// ==========================================================================
// PRUEBAS (frontend) — la pantalla ORIGINAL de Tablas sobre el motor de
// rifas independientes (tabla_id).
//
// abrirTabla + fuenteDeRifa (hooks/useTablaPrecio.ts) y las lecturas REALES
// de services/tablas/fuenteRifa.ts sobre una base falsa en memoria. Dos
// rifas del MISMO precio y del MISMO cliente (antes compartían las mismas
// filas físicas) y una de otro cliente:
//   - cada vista ve SOLO sus números, con el formato de siempre ("07");
//   - un aviso de Realtime de la otra rifa no la toca; uno propio se aplica;
//   - sorteo activo, actividad e historial (auditoría + archivo migrado) son
//     los de ESA rifa;
//   - el impacto del reinicio solo cuenta esa rifa y no menciona otras
//     tablas (preciosCompartidos vacío: desaparece el aviso de «también
//     afectará $1.000 y $2.000»).
//
//     node frontend/tests/tablas/tablaRifa.test.mjs
// ==========================================================================

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const FRONT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const ts = require(path.join(FRONT, "node_modules/typescript"));

const U = "11111111-0000-4000-8000-000000000001";
const OTRO = "22222222-0000-4000-8000-000000000002";
const R1 = "aaaaaaaa-0000-4000-8000-000000000001";   // $1.500 de U
const R2 = "aaaaaaaa-0000-4000-8000-000000000002";   // OTRA $1.500 de U
const R3 = "aaaaaaaa-0000-4000-8000-000000000003";   // $1.500 de OTRO cliente
const dormir = (ms) => new Promise(r => setTimeout(r, ms));

// ------------------------------------------------------ base falsa (SQL) ---
const db = {};
function reiniciarBase() {
    const rifa = (id, usuario) => ({ id, usuario_id: usuario, nombre: "Tabla $1.500", codigo: null, precio: 1500, cifras: 2, cantidad: 100, activa: true, ciclo: 1 });
    db.tablas_rifas = [rifa(R1, U), rifa(R2, U), rifa(R3, OTRO)];
    db.numeros_rifa = [];
    for (const [t, u] of [[R1, U], [R2, U], [R3, OTRO]]) {
        for (let n = 0; n < 100; n++) db.numeros_rifa.push({ id: `${t}-${n}`, tabla_id: t, usuario_id: u, numero: n, estado: "libre", comprador: null, actualizado_en: "2026-11-12T10:00:00Z" });
    }
    const ocupar = (t, n, estado, comprador) => Object.assign(db.numeros_rifa.find(f => f.tabla_id === t && f.numero === n),
        { estado, comprador, reservado_en: "2026-11-12T15:30:05Z", pagado_en: estado === "pagado" ? "2026-11-12T16:00:00Z" : null, identidad_evento_real: `id-${t}` });
    ocupar(R1, 7, "reservado", "Ana");
    ocupar(R2, 7, "pagado", "Beto");
    ocupar(R2, 8, "reservado", "Caro");
    ocupar(R3, 7, "reservado", "Ajeno");
    db.eventos_bot = [
        { id: "ev-r1", usuario_id: U, tabla: "reservas_dos_cifras", tabla_id: R1, valor: "1500", nombre_evento: "Sorteo R1", activo: true, creado_en: "2026-11-12T09:00:00Z" },
        { id: "ev-r2", usuario_id: U, tabla: "reservas_dos_cifras", tabla_id: R2, valor: "1500", nombre_evento: "Sorteo R2", activo: true, creado_en: "2026-11-12T11:00:00Z" }
    ];
    db.reservas_actividad = [
        { id: "a1", usuario_id: U, tabla_id: R1, tabla: "numeros_rifa", numero: "07", tipo: "reservado", creado_en: "2026-11-12T15:30:05Z" },
        { id: "a2", usuario_id: U, tabla_id: R2, tabla: "numeros_rifa", numero: "07", tipo: "pagado", creado_en: "2026-11-12T16:00:00Z" }
    ];
    db.reservas_auditoria = [
        { id: "x1", usuario_id: U, tabla_id: R1, accion: "reservar", numero: "07", resultado: "ok", creado_en: "2026-11-12T15:30:05Z" },
        { id: "x2", usuario_id: U, tabla_id: R2, accion: "pagar", numero: "07", resultado: "ok", creado_en: "2026-11-12T16:00:00Z" },
        { id: "x3", usuario_id: U, tabla_id: R1, accion: "crear_rifa", numero: "*", resultado: "ok", creado_en: "2026-11-01T00:00:00Z" }
    ];
    db.numeros_rifa_archivo = [
        { id: "h1", usuario_id: U, tabla_id: R1, numero: 5, estado: "pagado", motivo: "052: historial", archivado_en: "2026-11-12T07:00:00Z",
            fila: { tabla_legado: "reservas_dos_cifras", legado: { numero: "05", estado: "pagado", comprador: "Histórico", nombre_evento: "Lotería" } } }
    ];
    db.consultas = [];
}

// Constructor de consultas mínimo con la misma forma que supabase-js.
function consulta(tabla) {
    const filtros = [];
    let orden = null, desde = 0, hasta = Infinity, una = false;
    const q = {
        select() { return q; },
        eq(c, v) { filtros.push(f => String(f[c]) === String(v)); return q; },
        neq(c, v) { filtros.push(f => String(f[c]) !== String(v)); return q; },
        in(c, vs) { filtros.push(f => vs.map(String).includes(String(f[c]))); return q; },
        gte(c, v) { filtros.push(f => String(f[c]) >= String(v)); return q; },
        order(c, o = {}) { orden = { c, asc: o.ascending !== false }; return q; },
        range(a, b) { desde = a; hasta = b; return q; },
        limit(n) { hasta = desde + n - 1; return q; },
        maybeSingle() { una = true; return q; },
        then(res, rej) {
            db.consultas.push(tabla);
            let filas = (db[tabla] || []).filter(f => filtros.every(fn => fn(f)));
            if (orden) filas = [...filas].sort((a, b) => (a[orden.c] > b[orden.c] ? 1 : -1) * (orden.asc ? 1 : -1));
            filas = filas.slice(desde, hasta + 1).map(f => JSON.parse(JSON.stringify(f)));
            return Promise.resolve({ data: una ? (filas[0] ?? null) : filas, error: null }).then(res, rej);
        }
    };
    return q;
}

// ---------------------------------------------------- Realtime falso ---
const canalesAbiertos = new Set();
const supabase = {
    from: consulta,
    channel(nombre) {
        const canal = {
            nombre, binds: [],
            on(tipo, cfg, cb) { this.binds.push({ cfg, cb }); return this; },
            subscribe(cb) { canalesAbiertos.add(this); queueMicrotask(() => cb("SUBSCRIBED")); return this; }
        };
        return canal;
    },
    removeChannel(c) { canalesAbiertos.delete(c); }
};
function emitir(table, aviso) {
    for (const c of canalesAbiertos) for (const b of c.binds) {
        if (b.cfg.table !== table) continue;
        const [col, val] = (b.cfg.filter || "").split("=eq.");
        if (col && String(aviso.new?.[col]) !== val) continue;
        b.cb({ schema: "public", table, errors: null, old: {}, ...aviso });
    }
}
globalThis.window = { addEventListener() {}, removeEventListener() {} };

// --------------------------------------------------------- módulo real ---
const servicios = {
    "@/services/contactos/obtenerContactos": { obtenerContactos: async () => ({ contactos: [] }) },
    "@/services/auth/getUser": { getUser: async () => ({ data: { user: { id: U } } }) },
    "@/services/rifas/apiRifas": { apiRifas: { reiniciar: async () => ({ ok: true, archivados: 1, ciclo: 2 }) }, mensajeMotivo: (m) => m }
};
function cargarTs(rutaAbs, cache) {
    if (cache.has(rutaAbs)) return cache.get(rutaAbs).exports;
    const { outputText } = ts.transpileModule(fs.readFileSync(rutaAbs, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX }
    });
    const modulo = { exports: {} };
    cache.set(rutaAbs, modulo);
    const requerir = (spec) => {
        if (spec === "@/lib/supabase") return { supabase };
        if (servicios[spec]) return servicios[spec];
        const base = spec.startsWith("@/") ? path.join(FRONT, spec.slice(2)) : path.resolve(path.dirname(rutaAbs), spec);
        for (const ext of [".ts", ".tsx"]) if (fs.existsSync(base + ext)) return cargarTs(base + ext, cache);
        return require(spec);
    };
    new Function("require", "module", "exports", outputText)(requerir, modulo, modulo.exports);
    return modulo.exports;
}
const cache = new Map();
const { abrirTabla, fuenteDeRifa } = cargarTs(path.join(FRONT, "hooks/useTablaPrecio.ts"), cache);
const fuenteRifa = cargarTs(path.join(FRONT, "services/tablas/fuenteRifa.ts"), cache);

function abrir(tablaId, { historial = false } = {}) {
    const rifa = db.tablas_rifas.find(r => r.id === tablaId);
    const v = { numeros: [], evento: null, actividad: [], historial: null, loading: true, error: null };
    const vista = {
        setNumeros: (x) => { v.numeros = x; }, setEventoActivo: (x) => { v.evento = x; }, setActividad: (x) => { v.actividad = x; },
        setEventosHistorial: (x) => { v.historial = x; }, setContactos: () => {}, setHistorialCargado: () => {}, setDiagnostico: () => {},
        setError: (e) => { v.error = e; }, setLoading: (l) => { v.loading = l; }, setDesactualizada: () => {}
    };
    const control = abrirTabla({ precio: 1500, usuarioId: U, config: fuenteRifa.configDeRifa(rifa), historialPedido: () => historial, vista, fuente: fuenteDeRifa(rifa) });
    return { v, control };
}
const estadoDe = (v, n) => v.numeros.find(f => f.numero === n)?.estado;

let ok = 0;
async function prueba(nombre, fn) { reiniciarBase(); canalesAbiertos.clear(); await fn(); ok++; console.log(`✔ ${nombre}`); }

// ------------------------------------------------------------- pruebas ---

await prueba("dos rifas de $1.500 del mismo cliente: cada vista ve SOLO sus 100 números, con el formato de siempre", async () => {
    const a = abrir(R1), b = abrir(R2);
    await dormir(30);
    assert.strictEqual(a.v.error, null);
    assert.strictEqual(a.v.numeros.length, 100); assert.strictEqual(b.v.numeros.length, 100);
    assert.deepStrictEqual(a.v.numeros.slice(0, 3).map(f => f.numero), ["00", "01", "02"]);
    assert.strictEqual(estadoDe(a.v, "07"), "reservado"); assert.strictEqual(a.v.numeros.find(f => f.numero === "07").nombre, "Ana");
    assert.strictEqual(estadoDe(b.v, "07"), "pagado"); assert.strictEqual(estadoDe(b.v, "08"), "reservado");
    assert.strictEqual(estadoDe(a.v, "08"), "libre", "el 08 de la otra rifa no aparece en esta");
    assert.ok(a.v.numeros.every(f => f.usuario_id === U && f.comprador !== "Ajeno"), "nunca filas de otro cliente");
    assert.strictEqual(a.v.numeros.find(f => f.numero === "07").fecha_reserva, "2026-11-12");
    assert.strictEqual(a.v.numeros.find(f => f.numero === "07").hora_reserva, "10:30:05", "hora de Colombia con segundos, como antes");
    a.control.cerrar(); b.control.cerrar();
});

await prueba("tiempo real: el aviso de la otra rifa no toca esta; el propio se aplica con el formato de siempre", async () => {
    const a = abrir(R1);
    await dormir(30);
    const fila = db.numeros_rifa.find(f => f.tabla_id === R2 && f.numero === 9);
    Object.assign(fila, { estado: "reservado", comprador: "Otro" });
    emitir("numeros_rifa", { eventType: "UPDATE", new: { ...fila }, commit_timestamp: new Date().toISOString() });
    await dormir(20);
    assert.strictEqual(estadoDe(a.v, "09"), "libre", "aviso de R2 ignorado en R1");
    const propia = db.numeros_rifa.find(f => f.tabla_id === R1 && f.numero === 12);
    Object.assign(propia, { estado: "reservado", comprador: "Dani", reservado_en: "2026-11-12T17:00:00Z", actualizado_en: "2026-11-12T17:00:00Z" });
    emitir("numeros_rifa", { eventType: "UPDATE", new: { ...propia }, commit_timestamp: new Date(Date.now() + 1000).toISOString() });
    await dormir(20);
    assert.strictEqual(estadoDe(a.v, "12"), "reservado");
    assert.strictEqual(a.v.numeros.find(f => f.numero === "12").nombre, "Dani");
    a.control.cerrar();
});

await prueba("sorteo activo, actividad e historial: los de ESA rifa (archivo migrado incluido)", async () => {
    const a = abrir(R1, { historial: true });
    await dormir(30);
    a.control.cargarHistorial();
    await dormir(30);
    assert.strictEqual(a.v.evento?.id, "ev-r1", "el sorteo de R1, aunque R2 tenga uno más reciente del mismo precio");
    assert.deepStrictEqual(a.v.actividad.map(x => x.id), ["a1"]);
    assert.deepStrictEqual(a.v.historial.auditoria.map(x => x.id), ["x1"], "solo sus operaciones de números (sin crear_rifa)");
    assert.strictEqual(a.v.historial.archivo.length, 1);
    assert.strictEqual(a.v.historial.archivo[0].numero, "05");
    assert.strictEqual(a.v.historial.archivo[0].fila.comprador, "Histórico", "la fila antigua migrada se muestra tal cual");
    a.control.cerrar();
});

await prueba("reinicio: el impacto solo cuenta ESTA rifa y no menciona otras tablas", async () => {
    const r = await fuenteRifa.revisarReinicioRifa(db.tablas_rifas.find(x => x.id === R2), U);
    assert.strictEqual(r.sinCuadricula, false);
    assert.strictEqual(r.impacto.ocupados, 2);
    assert.deepStrictEqual(r.impacto.porEstado, { reservado: 1, pagado: 1, bloqueado: 0, en_proceso: 0, otros: 0 });
    assert.deepStrictEqual(r.impacto.preciosCompartidos, [], "sin aviso de «también afectará otros precios»");
    assert.deepStrictEqual(r.impacto.sorteosActivos, [{ nombre: "Sorteo R2", valor: 1500 }]);
    await assert.rejects(fuenteRifa.reiniciarRifa(db.tablas_rifas.find(x => x.id === R2), U, { texto: "REINICIAR", aceptaAnticipadas: false, huella: "otra" }),
        /cambió desde que la revisaste/, "si la rifa cambió desde la revisión, no se reinicia");
    const hecho = await fuenteRifa.reiniciarRifa(db.tablas_rifas.find(x => x.id === R2), U, { texto: "REINICIAR", aceptaAnticipadas: false, huella: r.impacto.huella });
    assert.strictEqual(hecho.accion, "reiniciada");
});

await prueba("al cerrar no queda ningún canal abierto", async () => {
    const a = abrir(R1);
    await dormir(20);
    assert.ok(canalesAbiertos.size > 0);
    a.control.cerrar();
    assert.strictEqual(canalesAbiertos.size, 0);
});

console.log(`\n${ok} pruebas OK`);
