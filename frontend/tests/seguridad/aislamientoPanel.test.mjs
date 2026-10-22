// ==========================================================================
// PRUEBAS — consultas del panel que van DIRECTO a Supabase desde el
// navegador (usuarios ficticios A y B):
//
//   1. obtenerEventos (/eventos): filtra por el usuario de la sesión de
//      Supabase Auth; sin sesión no consulta nada.
//   2. updateSession: solo envía `nombre`; usuario_id, activa, principal,
//      estado… se descartan aunque lleguen.
//
// IMPORTANTE: esto prueba lo que ENVÍA el panel. No prueba la base: quien
// edite las peticiones en el navegador se salta estos filtros. La barrera
// real son las políticas y permisos de docs/activacion/ (Partes A y D),
// probadas en Postgres real por
// backend/tests/seguridad/aislamientoClientesRls.test.js.
//
//     node frontend/tests/seguridad/aislamientoPanel.test.mjs
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

// Cliente de Supabase simulado: registra cada consulta y responde con las
// filas que cumplen los filtros .eq().
function crearCliente({ usuario, filas = {} }) {
    const consultas = [];
    const cliente = {
        auth: { getUser: async () => ({ data: { user: usuario ? { id: usuario } : null }, error: null }) },
        from(tabla) {
            const q = { tabla, filtros: [], update: null };
            consultas.push(q);
            const b = {
                select() { return b; },
                update(v) { q.update = v; return b; },
                eq(c, v) { q.filtros.push([c, v]); return b; },
                order() { return b; },
                then(ok, ko) {
                    const datos = (filas[tabla] || []).filter(f => q.filtros.every(([c, v]) => f[c] === v));
                    return Promise.resolve({ data: datos, error: null }).then(ok, ko);
                }
            };
            return b;
        }
    };
    return { cliente, consultas };
}

let clienteGlobal = null;

function cargarTs(rutaAbs) {
    const { outputText } = ts.transpileModule(fs.readFileSync(rutaAbs, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
    });
    const modulo = { exports: {} };
    const requerir = spec => {
        if (spec === "@/lib/supabase") return { supabase: new Proxy({}, { get: (_, p) => clienteGlobal[p] }) };
        return require(spec);
    };
    new Function("module", "exports", "require", outputText)(modulo, modulo.exports, requerir);
    return modulo.exports;
}

const { obtenerEventos } = cargarTs(path.join(FRONT, "services/eventos/obtenerEventos.ts"));
const { updateSession, soloCamposEditables } = cargarTs(path.join(FRONT, "services/sessions/updateSession.ts"));

const EVENTOS = {
    eventos_bot: [
        { id: 1, usuario_id: A, grupo_id: "gA" },
        { id: 2, usuario_id: B, grupo_id: "gB" }
    ]
};

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

prueba("/eventos: B solo recibe sus sorteos (filtro usuario_id = usuario de la sesión)", async () => {
    const { cliente, consultas } = crearCliente({ usuario: B, filas: EVENTOS });
    const datos = await obtenerEventos(cliente);
    assert.deepStrictEqual(datos.map(e => e.grupo_id), ["gB"]);
    assert.deepStrictEqual(consultas[0].filtros, [["usuario_id", B]]);
});

prueba("/eventos: sin sesión -> [] y no consulta la tabla", async () => {
    const { cliente, consultas } = crearCliente({ usuario: null, filas: EVENTOS });
    assert.deepStrictEqual(await obtenerEventos(cliente), []);
    assert.strictEqual(consultas.length, 0);
});

prueba("/eventos: por defecto usa el cliente del panel (llamada real de EventoGrid sin argumentos)", async () => {
    const { cliente, consultas } = crearCliente({ usuario: A, filas: EVENTOS });
    clienteGlobal = cliente;
    const datos = await obtenerEventos();
    assert.deepStrictEqual(datos.map(e => e.grupo_id), ["gA"]);
    assert.deepStrictEqual(consultas[0].filtros, [["usuario_id", A]]);
});

// Guardián de regresión: TODO el código del navegador que toca eventos_bot.
function fuentesPanel() {
    const salida = [];
    const recorrer = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) recorrer(p);
            else if (/\.(ts|tsx)$/.test(e.name)) salida.push(p);
        }
    };
    for (const d of ["app", "components", "services", "hooks", "lib"]) recorrer(path.join(FRONT, d));
    return salida;
}

prueba("eventos_bot desde el navegador: toda consulta filtra por usuario_id y ninguna escribe", async () => {
    let consultasVistas = 0;
    for (const archivo of fuentesPanel()) {
        const src = fs.readFileSync(archivo, "utf8");
        for (const m of src.matchAll(/\.from\(\s*["']eventos_bot["']\s*\)/g)) {
            consultasVistas++;
            // La cadena de la consulta hasta su ";" final.
            const cadena = src.slice(m.index, src.indexOf(";", m.index));
            const rel = path.relative(FRONT, archivo);
            assert.ok(/\.eq\(\s*["']usuario_id["']/.test(cadena), `${rel}: consulta a eventos_bot sin filtro usuario_id`);
            assert.ok(!/\.(update|insert|upsert|delete)\(/.test(cadena), `${rel}: el panel no escribe eventos_bot (solo el bot)`);
            // El usuario sale de la sesión de Supabase Auth del archivo o de su llamador.
            assert.ok(/getUser\(|usuarioId|uid/.test(cadena), `${rel}: filtro sin usuario de sesión`);
        }
        for (const m of src.matchAll(/table:\s*["']eventos_bot["'](.*)/g)) {
            assert.ok(/filter:\s*`usuario_id=eq\.\$\{usuarioId\}`/.test(m[1]), `${path.relative(FRONT, archivo)}: suscripción en tiempo real a eventos_bot sin filtro por usuario`);
            assert.ok(/await getUser\(\)/.test(src), `${path.relative(FRONT, archivo)}: el usuario de la suscripción no sale de la sesión`);
        }
    }
    assert.ok(consultasVistas >= 3, `se revisaron ${consultasVistas} consultas`);
});

prueba("/eventos: A y B, cada uno solo lo suyo; filas sin dueño no aparecen para nadie", async () => {
    const filas = { eventos_bot: [...EVENTOS.eventos_bot, { id: 3, usuario_id: null, grupo_id: "sin-dueno" }] };
    for (const [usuario, esperado] of [[A, ["gA"]], [B, ["gB"]]]) {
        const { cliente } = crearCliente({ usuario, filas });
        assert.deepStrictEqual((await obtenerEventos(cliente)).map(e => e.grupo_id), esperado);
    }
});

prueba("updateSession: solo envía nombre aunque lleguen usuario_id/activa/principal/estado", async () => {
    const { cliente, consultas } = crearCliente({ usuario: B });
    clienteGlobal = cliente;
    await updateSession("ses-b", { nombre: "Ventas", usuario_id: A, activa: true, principal: true, estado: "conectado" });
    assert.deepStrictEqual(consultas[0].update, { nombre: "Ventas" });
    assert.deepStrictEqual(soloCamposEditables({ nombre: "x", usuario_id: A }), { nombre: "x" });
});

let ok = 0, falla = 0;
for (const { n, fn } of pruebas) {
    try { await fn(); ok++; console.log(`✅ ${n}`); }
    catch (e) { falla++; console.log(`❌ ${n}`); console.log(String(e && e.stack || e)); }
}
console.log(`\n============================\nTOTAL: ${ok + falla}  ✅ PASA: ${ok}  ❌ FALLA: ${falla}\n============================`);
process.exit(falla ? 1 : 0);
