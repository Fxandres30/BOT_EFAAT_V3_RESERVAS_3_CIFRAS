// ==========================================================================
// PRUEBAS: bot/funciones/reservas/liberacion.js, la fuente única de lo que
// significa liberar un número (F1-B, 06/11/2026).
//
// 1) La lista del backend es la MISMA que las dos que no pueden importarla:
//    el reinicio seguro en SQL (migración 030, reiniciar_tabla_cliente) y
//    el reinicio del panel (frontend/services/tablas/reiniciarTabla.ts).
//    Si alguien añade o quita un campo en una sola, esta prueba falla.
// 2) consultaLiberacion: solo la cuadrícula del cliente, con esos campos, y
//    sin usuario no toca nada.
// 3) Ningún archivo del backend vuelve a escribir su propia lista.
//
//     node backend/tests/reservas/liberacion.test.js
// ==========================================================================

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);

const { CAMPOS_LIBERACION, consultaLiberacion } = require(r("bot/funciones/reservas/liberacion.js"));

const ordenadas = (o) => Object.keys(o).sort();

// Lista de columnas = null de un bloque de texto «col = null» o «col: null».
const nulosDe = (texto, sep) => [...texto.matchAll(new RegExp(`([a-z_]+)\\s*${sep}\\s*null`, "g"))].map(m => m[1]);

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

prueba("19 campos a null + estado «libre», inmutable", () => {
    assert.strictEqual(CAMPOS_LIBERACION.estado, "libre");
    const campos = Object.entries(CAMPOS_LIBERACION).filter(([k]) => k !== "estado");
    assert.strictEqual(campos.length, 19);
    assert.ok(campos.every(([, v]) => v === null));
    assert.ok(Object.isFrozen(CAMPOS_LIBERACION));
    assert.ok("telefono_bot" in CAMPOS_LIBERACION && "ip_reserva" in CAMPOS_LIBERACION, "C5: también estos dos");
});

prueba("misma lista que el reinicio seguro en SQL (030)", () => {
    const sql = fs.readFileSync(r("supabase_migrations/030_reinicio_tabla_seguro.sql"), "utf8");
    const bloque = sql.match(/execute format\('update public\.%I set([\s\S]*?)where usuario_id/);
    assert.ok(bloque, "UPDATE de la 030 localizado");
    assert.ok(/estado\s*=\s*''libre''/.test(bloque[1]));
    assert.deepStrictEqual(nulosDe(bloque[1], "=").sort(), ordenadas(CAMPOS_LIBERACION).filter(k => k !== "estado"));
});

prueba("misma lista que el reinicio del panel (reiniciarTabla.ts)", () => {
    const ts = fs.readFileSync(r("../frontend/services/tablas/reiniciarTabla.ts"), "utf8");
    const bloque = ts.match(/const CAMPOS_LIBRE = \{([\s\S]*?)\};/);
    assert.ok(bloque, "CAMPOS_LIBRE del panel localizado");
    assert.ok(/estado:\s*"libre"/.test(bloque[1]));
    assert.deepStrictEqual(nulosDe(bloque[1], ":").sort(), ordenadas(CAMPOS_LIBERACION).filter(k => k !== "estado"));
});

prueba("consultaLiberacion: UPDATE con los campos canónicos y filtro del cliente", () => {
    const llamadas = [];
    const q = { update(p) { llamadas.push(["update", p]); return q; }, eq(c, v) { llamadas.push(["eq", c, v]); return q; } };
    const supabase = { from(t) { llamadas.push(["from", t]); return q; } };
    consultaLiberacion(supabase, { usuarioId: "u-1", tabla: "tabla_3000" });
    assert.deepStrictEqual(llamadas[0], ["from", "tabla_3000"]);
    assert.deepStrictEqual(llamadas[1], ["update", { ...CAMPOS_LIBERACION }]);
    assert.notStrictEqual(llamadas[1][1], CAMPOS_LIBERACION, "se envía una copia, nunca el objeto compartido");
    assert.deepStrictEqual(llamadas[2], ["eq", "usuario_id", "u-1"]);
});

prueba("consultaLiberacion sin usuario: no toca ninguna fila", async () => {
    const original = console.error;
    console.error = () => {};
    try {
        let tocado = false;
        const q = { update() { return q; }, eq() { tocado = true; return q; } };
        const res = await consultaLiberacion({ from: () => q }, { usuarioId: null, tabla: "tabla_3000" }).eq("numero", "07").select();
        assert.strictEqual(tocado, false);
        assert.strictEqual(res.data, null);
        assert.ok(res.error);
    } finally { console.error = original; }
});

prueba("ningún archivo del backend define otra lista de liberación", () => {
    const sospechosos = [];
    const recorrer = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) { if (!["node_modules", "tests", "supabase_migrations"].includes(e.name)) recorrer(p); continue; }
            if (!e.name.endsWith(".js") || e.name.startsWith("_") || p === r("bot/funciones/reservas/liberacion.js")) continue;
            const t = fs.readFileSync(p, "utf8");
            // Un objeto con estado "libre" y varios campos del comprador a null.
            if (/estado:\s*"libre"[\s\S]{0,200}comprador:\s*null[\s\S]{0,200}fecha_reserva:\s*null/.test(t)) sospechosos.push(path.relative(RAIZ, p));
        }
    };
    recorrer(RAIZ);
    assert.deepStrictEqual(sospechosos, []);
});

(async () => {
    let fallos = 0;
    for (const { n, fn } of pruebas) {
        try { await fn(); console.log(`✅ ${n}`); } catch (e) { fallos++; console.log(`❌ ${n}\n   ${e.message}`); }
    }
    console.log(`\n${pruebas.length - fallos}/${pruebas.length} pruebas OK`);
    process.exitCode = fallos ? 1 : 0;
})();
