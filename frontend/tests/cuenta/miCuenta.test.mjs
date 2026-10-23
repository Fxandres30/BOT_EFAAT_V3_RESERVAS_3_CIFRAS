// ==========================================================================
// PRUEBAS — «Mi cuenta» (usuarios ficticios A y B, Auth simulado):
//
//   1. lib/cuenta/cuenta.ts: el perfil y los cambios usan SIEMPRE el usuario
//      de la sesión; la contraseña solo cambia tras verificar la actual con
//      el correo de la sesión (nunca uno recibido).
//   2. lib/cuenta/resumenGrupos.ts: conteos de grupos y conexiones; el cupo
//      contratado no se inventa (null).
//   3. lib/comercial/planes.ts: enlaceSoporte va al correo de soporte.
//   4. Guardián: las pantallas de components/cuenta no consultan tablas
//      directamente ni escriben nada salvo por lib/cuenta.
//
//     node frontend/tests/cuenta/miCuenta.test.mjs
// ==========================================================================

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const FRONT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const ts = require(path.join(FRONT, "node_modules/typescript"));

function cargarTs(rutaAbs) {
    const { outputText } = ts.transpileModule(fs.readFileSync(rutaAbs, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
    });
    const modulo = { exports: {} };
    new Function("module", "exports", "require", outputText)(modulo, modulo.exports, require);
    return modulo.exports;
}

const cuenta = cargarTs(path.join(FRONT, "lib/cuenta/cuenta.ts"));
const { resumirGrupos } = cargarTs(path.join(FRONT, "lib/cuenta/resumenGrupos.ts"));
const planes = cargarTs(path.join(FRONT, "lib/comercial/planes.ts"));

const A = { id: "aaaaaaaa-0000-4000-8000-00000000000a", email: "ana@prueba.local", created_at: "2026-01-02T15:00:00Z", last_sign_in_at: "2026-10-22T03:00:00Z", email_confirmed_at: "2026-01-02T15:10:00Z", user_metadata: { nombre: "  Ana  " } };
const B = { id: "bbbbbbbb-0000-4000-8000-00000000000b", email: "beto@prueba.local", user_metadata: {} };

// Auth simulado: registra las llamadas. `claves` = contraseña real por correo.
function crearAuth({ usuario, claves = {}, falloUpdate = false }) {
    const llamadas = [];
    return {
        llamadas,
        async getUser() { llamadas.push(["getUser"]); return { data: { user: usuario }, error: null }; },
        async updateUser(c) { llamadas.push(["updateUser", c]); return { error: falloUpdate ? { message: "x" } : null }; },
        async signInWithPassword(c) {
            llamadas.push(["signIn", c]);
            const usr = [A, B].find(u => u.email === c.email);
            return claves[c.email] === c.password ? { data: { user: usr }, error: null } : { data: { user: null }, error: { message: "Invalid login credentials" } };
        }
    };
}

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

prueba("perfil: datos del usuario de la sesión, nombre recortado", async () => {
    const p = await cuenta.obtenerPerfil(crearAuth({ usuario: A }));
    assert.deepStrictEqual(p, { id: A.id, correo: A.email, nombre: "Ana", creadaEn: A.created_at, ultimoAcceso: A.last_sign_in_at, correoConfirmado: true });
});

prueba("perfil: sin sesión -> null", async () => {
    assert.strictEqual(await cuenta.obtenerPerfil(crearAuth({ usuario: null })), null);
});

prueba("perfil: sin nombre ni confirmación -> null / false (no se inventa)", async () => {
    const p = await cuenta.obtenerPerfil(crearAuth({ usuario: B }));
    assert.strictEqual(p.nombre, null);
    assert.strictEqual(p.correoConfirmado, false);
    assert.strictEqual(p.creadaEn, null);
});

prueba("nombre: valida vacío, largo y caracteres de control/HTML", () => {
    assert.strictEqual(cuenta.validarNombre("   ").ok, false);
    assert.strictEqual(cuenta.validarNombre("x".repeat(81)).ok, false);
    assert.strictEqual(cuenta.validarNombre("Ana<script>").ok, false);
    assert.strictEqual(cuenta.validarNombre("Ana\u0007").ok, false);
    assert.deepStrictEqual(cuenta.validarNombre("  Ana   María "), { ok: true, nombre: "Ana María" });
});

prueba("nombre: solo envía { data: { nombre } } (nada de email, rol ni metadatos ajenos)", async () => {
    const auth = crearAuth({ usuario: A });
    assert.deepStrictEqual(await cuenta.actualizarNombre(auth, " Ana  Gómez "), { ok: true });
    const upd = auth.llamadas.filter(l => l[0] === "updateUser");
    assert.deepStrictEqual(upd, [["updateUser", { data: { nombre: "Ana Gómez" } }]]);
});

prueba("nombre: sin sesión no llama a updateUser", async () => {
    const auth = crearAuth({ usuario: null });
    assert.strictEqual((await cuenta.actualizarNombre(auth, "Ana")).ok, false);
    assert.ok(!auth.llamadas.some(l => l[0] === "updateUser"));
});

prueba("contraseña: verifica la actual con el correo de la SESIÓN y luego cambia", async () => {
    const auth = crearAuth({ usuario: A, claves: { [A.email]: "vieja-segura-1" } });
    assert.deepStrictEqual(await cuenta.cambiarContrasena(auth, "vieja-segura-1", "Nueva-clave-larga-9"), { ok: true });
    assert.deepStrictEqual(auth.llamadas.find(l => l[0] === "signIn")[1], { email: A.email, password: "vieja-segura-1" });
    assert.deepStrictEqual(auth.llamadas.find(l => l[0] === "updateUser")[1], { password: "Nueva-clave-larga-9" });
});

prueba("contraseña: actual incorrecta -> no cambia nada", async () => {
    const auth = crearAuth({ usuario: A, claves: { [A.email]: "vieja-segura-1" } });
    const r = await cuenta.cambiarContrasena(auth, "otra", "Nueva-clave-larga-9");
    assert.deepStrictEqual(r, { ok: false, error: "La contraseña actual no es correcta." });
    assert.ok(!auth.llamadas.some(l => l[0] === "updateUser"));
});

prueba("contraseña: la verificación devuelve OTRO usuario -> se rechaza", async () => {
    // Sesión de A cuyo correo resolviera a la cuenta de B: nunca se cambia.
    const auth = crearAuth({ usuario: { ...A, email: B.email }, claves: { [B.email]: "clave-de-beto" } });
    const r = await cuenta.cambiarContrasena(auth, "clave-de-beto", "Nueva-clave-larga-9");
    assert.strictEqual(r.ok, false);
    assert.ok(!auth.llamadas.some(l => l[0] === "updateUser"));
});

prueba("contraseña: vacía, igual a la actual o sin sesión -> no consulta Auth", async () => {
    for (const [usuario, actual, nueva] of [[A, "", "x"], [A, "misma-clave-1", "misma-clave-1"], [null, "a", "b"]]) {
        const auth = crearAuth({ usuario });
        assert.strictEqual((await cuenta.cambiarContrasena(auth, actual, nueva)).ok, false);
        assert.ok(!auth.llamadas.some(l => l[0] === "signIn" || l[0] === "updateUser"));
    }
});

prueba("contraseña: fallo de updateUser se informa sin exponer el motivo técnico", async () => {
    const auth = crearAuth({ usuario: A, claves: { [A.email]: "vieja-segura-1" }, falloUpdate: true });
    const r = await cuenta.cambiarContrasena(auth, "vieja-segura-1", "Nueva-clave-larga-9");
    assert.strictEqual(r.ok, false);
    assert.ok(!r.error.includes("x"));
});

prueba("formatearFecha: hora de Colombia y null si no hay fecha", () => {
    // 03:00 UTC del 22 = 22:00 del 21 en Bogotá.
    assert.strictEqual(cuenta.formatearFecha("2026-10-22T03:00:00Z"), "21 de octubre de 2026");
    assert.strictEqual(cuenta.formatearFecha(null), null);
    assert.strictEqual(cuenta.formatearFecha("no-es-fecha"), null);
});

const auth = (grupo_id, activo) => ({ id: `id-${grupo_id}`, usuario_id: A.id, grupo_id, activo, creado_en: "", actualizado_en: "" });

prueba("resumen de grupos: conteos reales y cupo contratado null", () => {
    const sesiones = [
        { sessionId: "s1", nombreSesion: "Principal", telefono: null, conectada: true, estado: "conectada", grupos: [], error: null },
        { sessionId: "s2", nombreSesion: "Respaldo", telefono: null, conectada: false, estado: "desconectada", grupos: [], error: null },
        { sessionId: "s3", nombreSesion: "Otra", telefono: null, conectada: false, estado: "no_verificable", grupos: [], error: null }
    ];
    const merge = {
        disponibles: [
            { grupoId: "g1", nombre: "Sorteo 1", conectado: true, sesiones: [{ sessionId: "s1", nombreSesion: "Principal" }], autorizacion: auth("g1", true) },
            { grupoId: "g2", nombre: "Sin autorizar", conectado: true, sesiones: [], autorizacion: null }
        ],
        historicos: [
            { grupoId: "g3", nombre: "g3", conectado: false, sesiones: [], autorizacion: auth("g3", false) },
            { grupoId: "g4", nombre: "g4", conectado: false, sesiones: [], autorizacion: auth("g4", true) }
        ]
    };
    const r = resumirGrupos(sesiones, merge);
    assert.deepStrictEqual(r.conexiones, { total: 3, conectadas: 1, desconectadas: 1, sinVerificar: 1 });
    assert.deepStrictEqual(r.enUso.map(g => g.grupoId), ["g1", "g4"]);
    assert.deepStrictEqual(r.pausados.map(g => g.grupoId), ["g3"]);
    assert.strictEqual(r.cupoContratado, null);
});

prueba("enlaceSoporte: mailto al correo de soporte con el correo de la cuenta", () => {
    const url = planes.enlaceSoporte("renovacion", A.email);
    assert.ok(url.startsWith(`mailto:${planes.CORREO_COMERCIAL}?`));
    assert.ok(decodeURIComponent(url).includes(`Correo de mi cuenta: ${A.email}`));
    const cambio = decodeURIComponent(planes.enlaceSoporte("cambio_plan", null, planes.PLANES[1]));
    assert.ok(cambio.includes("plan Profesional"));
});

// Guardián: las pantallas no hablan con Supabase por su cuenta; todo pasa por
// lib/cuenta (Auth del propio usuario) o por los servicios ya existentes de
// sesiones/grupos, que filtran por el usuario de la sesión.
prueba("components/cuenta: sin consultas directas a tablas ni escrituras", () => {
    const dir = path.join(FRONT, "components/cuenta");
    for (const archivo of fs.readdirSync(dir).filter(f => f.endsWith(".tsx"))) {
        const src = fs.readFileSync(path.join(dir, archivo), "utf8");
        assert.ok(!/\.from\(/.test(src), `${archivo}: consulta directa a una tabla`);
        assert.ok(!/\.(insert|upsert|delete|rpc)\(/.test(src), `${archivo}: escritura directa`);
        assert.ok(!/updateUser\(/.test(src), `${archivo}: cambia Auth sin pasar por lib/cuenta`);
        assert.ok(!/usuario_?id\s*[:=]\s*(params|searchParams|props)/i.test(src), `${archivo}: usuario tomado de la URL`);
    }
});

let fallos = 0;
for (const { n, fn } of pruebas) {
    try { await fn(); console.log(`  ok  ${n}`); }
    catch (e) { fallos++; console.log(`  FALLA  ${n}\n        ${e.message}`); }
}
console.log(`\n${pruebas.length - fallos}/${pruebas.length} pruebas correctas`);
process.exit(fallos ? 1 : 0);
