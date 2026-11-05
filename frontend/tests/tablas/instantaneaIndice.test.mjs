// ==========================================================================
// PRUEBAS (frontend) — instantánea del índice de Reservas en localStorage
// (persistencia tras recargar; excepción autorizada el 05/11/2026).
//
//   1. Solo se guardan los campos de la lista blanca: nada de cuentas de
//      pago, titulares, mensajes, premios, teléfonos ni participantes.
//   2. Aislamiento por usuario: la de otro usuario nunca se lee; guardar deja
//      solo la del usuario actual.
//   3. Vigencia 24 h; versión, usuario y contenido dañado -> se borra.
//   4. Cierre de sesión / cambio de cuenta (hooks/useSesion.ts::fijarUsuario)
//      borran las instantáneas SIN tocar otras claves del navegador.
//   5. Sin localStorage (bloqueado/lleno): no falla, simplemente no hay.
//
// Módulos REALES transpilados con el TypeScript del proyecto.
//
//     node frontend/tests/tablas/instantaneaIndice.test.mjs
// ==========================================================================

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const FRONT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const ts = require(path.join(FRONT, "node_modules/typescript"));

function crearAlmacen() {
    const m = new Map();
    return {
        m,
        bloqueado: false,
        lleno: false,
        get length() { return m.size; },
        key(i) { return [...m.keys()][i] ?? null; },
        getItem(k) { if (this.bloqueado) throw new Error("bloqueado"); return m.has(k) ? m.get(k) : null; },
        setItem(k, v) { if (this.bloqueado || this.lleno) throw new Error("QuotaExceeded"); m.set(k, String(v)); },
        removeItem(k) { if (this.bloqueado) throw new Error("bloqueado"); m.delete(k); }
    };
}

const ls = crearAlmacen();
let sinAcceso = false;
globalThis.window = {};
Object.defineProperty(globalThis.window, "localStorage", { get() { if (sinAcceso) throw new Error("SecurityError"); return ls; } });

function cargarTs(rutaAbs, cache = new Map()) {
    if (cache.has(rutaAbs)) return cache.get(rutaAbs).exports;
    const { outputText } = ts.transpileModule(fs.readFileSync(rutaAbs, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX }
    });
    const modulo = { exports: {} };
    cache.set(rutaAbs, modulo);
    const requerir = (spec) => {
        if (spec === "@/lib/supabase") return { supabase: { auth: {} } };
        const base = spec.startsWith("@/") ? path.join(FRONT, spec.slice(2)) : path.resolve(path.dirname(rutaAbs), spec);
        for (const ext of [".ts", ".tsx"]) if (fs.existsSync(base + ext)) return cargarTs(base + ext, cache);
        return require(path.join(FRONT, "node_modules", spec));
    };
    new Function("require", "module", "exports", outputText)(requerir, modulo, modulo.exports);
    return modulo.exports;
}

const cache = new Map();
const inst = cargarTs(path.join(FRONT, "services/tablas/instantaneaIndice.ts"), cache);
const { fijarUsuario, usuarioSesionLocal } = cargarTs(path.join(FRONT, "hooks/useSesion.ts"), cache);
const P = inst.PREFIJO_INSTANTANEA;

const TABLAS = [{ precio: 5000, tabla: "5k_15k_reservas_2_cifras", cifras: 2, cantidad: 100 }];
const publicarEn = new Date(Date.now() + 3600_000);

function instantanea(usuarioId, extra = {}) {
    return {
        usuarioId,
        leidoEn: Date.now(),
        tablas: TABLAS,
        estados: [{ precio: 5000, entradas: [{ estado: "programado", clave: "s1", nombre: "Lotería de Prueba", publicarEn, grupos: 2 }] }],
        disponibles: { activos: true, programados: true },
        ...extra
    };
}

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });
const reiniciar = () => { ls.m.clear(); ls.bloqueado = false; ls.lleno = false; sinAcceso = false; };

prueba("guardar y leer: mismos datos visibles, fecha restaurada", () => {
    reiniciar();
    inst.guardarInstantanea(instantanea("A"));
    const r = inst.leerInstantanea("A");
    assert.ok(r);
    assert.strictEqual(r.usuarioId, "A");
    assert.deepStrictEqual(r.tablas, TABLAS);
    const e = r.estados[0].entradas[0];
    assert.strictEqual(e.nombre, "Lotería de Prueba");
    assert.ok(e.publicarEn instanceof Date && e.publicarEn.getTime() === publicarEn.getTime());
    assert.deepStrictEqual(r.disponibles, { activos: true, programados: true });
});

prueba("lista blanca: no se guardan cuentas, titulares, mensajes, premios ni teléfonos", () => {
    reiniciar();
    const sucia = instantanea("A");
    sucia.estados[0].entradas[0] = {
        ...sucia.estados[0].entradas[0],
        cuentas: [{ numero: "3001234567", titular: "Ana Pérez" }],
        mensajes: { publicacion: "texto" }, premios: [{ nombre: "Moto" }], telefono: "573001234567"
    };
    sucia.participantes = [{ nombre: "Juan", telefono: "573009999999" }];
    sucia.tablas = [{ ...TABLAS[0], titular: "Ana Pérez" }];
    inst.guardarInstantanea(sucia);
    const crudo = ls.m.get(P + "A");
    for (const prohibido of ["3001234567", "Ana Pérez", "texto", "Moto", "573001234567", "Juan", "573009999999", "cuentas", "mensajes", "participantes"]) {
        assert.ok(!crudo.includes(prohibido), `se guardó «${prohibido}»`);
    }
});

prueba("aislamiento: la de otro usuario nunca se lee; guardar deja solo la propia", () => {
    reiniciar();
    inst.guardarInstantanea(instantanea("A"));
    assert.strictEqual(inst.leerInstantanea("B"), null);
    // Clave de B con contenido de A (manipulada): se rechaza y se borra.
    ls.m.set(P + "B", ls.m.get(P + "A"));
    assert.strictEqual(inst.leerInstantanea("B"), null);
    assert.ok(!ls.m.has(P + "B"));
    inst.guardarInstantanea(instantanea("B"));
    assert.ok(!ls.m.has(P + "A"), "al guardar B desaparece la de A");
    assert.ok(inst.leerInstantanea("B"));
    assert.strictEqual(inst.leerInstantanea(null), null);
});

prueba("vigencia máxima 24 h; fecha futura, versión y contenido dañado -> se borra", () => {
    reiniciar();
    inst.guardarInstantanea(instantanea("A", { leidoEn: Date.now() - 24 * 3600_000 - 1000 }));
    assert.strictEqual(inst.leerInstantanea("A"), null);
    assert.ok(!ls.m.has(P + "A"));

    inst.guardarInstantanea(instantanea("A", { leidoEn: Date.now() - 23 * 3600_000 }));
    assert.ok(inst.leerInstantanea("A"), "23 h: vigente");

    inst.guardarInstantanea(instantanea("A", { leidoEn: Date.now() + 3600_000 }));
    assert.strictEqual(inst.leerInstantanea("A"), null, "leída en el futuro: no fiable");

    ls.m.set(P + "A", JSON.stringify({ ...JSON.parse(JSON.stringify(instantanea("A"))), v: 2 }));
    assert.strictEqual(inst.leerInstantanea("A"), null, "otra versión");

    ls.m.set(P + "A", "{no es json");
    assert.strictEqual(inst.leerInstantanea("A"), null);
    assert.ok(!ls.m.has(P + "A"));

    ls.m.set(P + "A", JSON.stringify({ v: 1, usuarioId: "A", leidoEn: Date.now(), tablas: TABLAS, estados: [{ precio: 5000, entradas: [{ estado: "inventado", clave: "x" }] }] }));
    assert.strictEqual(inst.leerInstantanea("A"), null, "estado desconocido");
});

prueba("cierre de sesión y cambio de cuenta (useSesion) borran SOLO las instantáneas", () => {
    reiniciar();
    ls.m.set("efaat:secciones:A", "1");
    ls.m.set("sb-127-auth-token", "sesion");
    ls.m.set("efaat-analitica", "x");

    fijarUsuario("A");
    inst.guardarInstantanea(instantanea("A"));
    assert.strictEqual(usuarioSesionLocal(), "A");
    fijarUsuario("A");
    assert.ok(inst.leerInstantanea("A"), "mismo usuario: se conserva (recarga)");

    fijarUsuario("B");
    assert.strictEqual(inst.leerInstantanea("A"), null, "cambio de cuenta: la de A desaparece");
    assert.strictEqual(usuarioSesionLocal(), "B");

    inst.guardarInstantanea(instantanea("B"));
    fijarUsuario(null);
    assert.strictEqual([...ls.m.keys()].filter(k => k.startsWith(P)).length, 0, "cerrar sesión: ninguna");
    assert.strictEqual(usuarioSesionLocal(), null);

    assert.strictEqual(ls.m.get("efaat:secciones:A"), "1");
    assert.strictEqual(ls.m.get("sb-127-auth-token"), "sesion");
    assert.strictEqual(ls.m.get("efaat-analitica"), "x");
});

prueba("sin localStorage (bloqueado, lleno o inaccesible): no falla", () => {
    reiniciar();
    ls.lleno = true;
    inst.guardarInstantanea(instantanea("A"));
    assert.strictEqual(inst.leerInstantanea("A"), null);
    ls.lleno = false;
    ls.bloqueado = true;
    inst.guardarInstantanea(instantanea("A"));
    assert.strictEqual(inst.leerInstantanea("A"), null);
    inst.borrarInstantaneas();
    ls.bloqueado = false;
    sinAcceso = true;
    inst.guardarInstantanea(instantanea("A"));
    assert.strictEqual(inst.leerInstantanea("A"), null);
    inst.borrarInstantaneas();
    fijarUsuario(null);
    sinAcceso = false;
});

let fallos = 0;
for (const { n, fn } of pruebas) {
    try { await fn(); console.log(`  ok  ${n}`); }
    catch (e) { fallos++; console.log(`  FALLO  ${n}\n        ${e.stack}`); }
}
console.log(`\n${pruebas.length - fallos}/${pruebas.length} correctas`);
process.exit(fallos ? 1 : 0);
