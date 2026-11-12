// ==========================================================================
// PRUEBAS (frontend) — sesión global y navegación de entrada (12/11/2026).
//
//   hooks/useSesion.ts (estado compartido por la pestaña):
//     1. «cargando» solo hasta la primera respuesta; después, los montajes
//        nuevos (cambio de sección) reciben el estado conocido al instante.
//     2. UNA sola lectura inicial y UNA suscripción a Supabase Auth.
//     3. TOKEN_REFRESHED / SIGNED_IN no notifican (sin pantalla de carga).
//     4. SIGNED_OUT -> «sin_sesion» (la guardia manda a /login).
//     5. Cambio de cuenta: borra la instantánea del usuario anterior.
//     6. Lectura inicial desfasada (llega después de un evento) se descarta.
//   lib/navegacion.ts:
//     7. RUTA_INICIO = /tablas.
//     8. «volver»: solo rutas internas del panel; nada externo ni de auth.
//   Puntos de entrada: ninguno manda ya a /sesiones fijo.
//
// Módulos REALES transpilados con el TypeScript del proyecto. Supabase y
// React se sustituyen por dobles: no hay red.
//
//     node frontend/tests/auth/sesionGlobal.test.mjs
// ==========================================================================

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const FRONT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const ts = require(path.join(FRONT, "node_modules/typescript"));
const leer = (r) => fs.readFileSync(path.join(FRONT, r), "utf8");

// --- Doble de Supabase Auth -------------------------------------------------
function crearAuth() {
    const auth = {
        lecturas: 0,
        suscripciones: 0,
        oyente: null,
        resolverLectura: null,
        getSession() {
            auth.lecturas++;
            return new Promise((r) => { auth.resolverLectura = (sesion) => r({ data: { session: sesion } }); });
        },
        onAuthStateChange(fn) {
            auth.suscripciones++;
            auth.oyente = fn;
            return { data: { subscription: { unsubscribe() {} } } };
        },
        emitir(evento, sesion) { auth.oyente(evento, sesion); }
    };
    return auth;
}

// --- Doble mínimo de useSyncExternalStore: suscribe y devuelve la foto ------
function crearReact() {
    const montajes = [];
    return {
        montajes,
        useSyncExternalStore(suscribir, foto) {
            const m = { avisos: 0 };
            m.baja = suscribir(() => { m.avisos++; });
            montajes.push(m);
            return foto();
        }
    };
}

const borradas = [];

function cargarTs(rutaAbs, dobles, cache = new Map()) {
    if (cache.has(rutaAbs)) return cache.get(rutaAbs).exports;
    const { outputText } = ts.transpileModule(fs.readFileSync(rutaAbs, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
    });
    const modulo = { exports: {} };
    cache.set(rutaAbs, modulo);
    const requerir = (spec) => {
        if (spec in dobles) return dobles[spec];
        const base = spec.startsWith("@/") ? path.join(FRONT, spec.slice(2)) : path.resolve(path.dirname(rutaAbs), spec);
        for (const ext of [".ts", ".tsx"]) if (fs.existsSync(base + ext)) return cargarTs(base + ext, dobles, cache);
        return require(path.join(FRONT, "node_modules", spec));
    };
    new Function("require", "module", "exports", outputText)(requerir, modulo, modulo.exports);
    return modulo.exports;
}

// Instancia NUEVA del módulo (estado de módulo limpio = pestaña nueva).
function pestanaNueva() {
    const auth = crearAuth();
    const react = crearReact();
    const mod = cargarTs(path.join(FRONT, "hooks/useSesion.ts"), {
        "@/lib/supabase": { supabase: { auth } },
        "@/services/tablas/instantaneaIndice": { borrarInstantaneas: (id) => borradas.push(id) },
        "react": react
    });
    return { auth, react, mod };
}

globalThis.window = {};
const tick = () => new Promise((r) => setImmediate(r));
const sesion = (id) => ({ user: { id }, access_token: `tok-${id}` });

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

prueba("arranque: «cargando» hasta la primera respuesta; luego con_sesion", async () => {
    const { auth, mod } = pestanaNueva();
    assert.strictEqual(mod.useSesion(), "cargando");
    auth.resolverLectura(sesion("A"));
    await tick();
    assert.strictEqual(mod.useSesion(), "con_sesion");
    assert.strictEqual(mod.usuarioSesionLocal(), "A");
});

prueba("cambio de sección: el montaje nuevo recibe con_sesion al instante (sin pantalla de carga)", async () => {
    const { auth, mod } = pestanaNueva();
    mod.useSesion();
    auth.resolverLectura(sesion("A"));
    await tick();
    for (let i = 0; i < 10; i++) assert.strictEqual(mod.useSesion(), "con_sesion", `montaje ${i}`);
    assert.strictEqual(auth.lecturas, 1, "una sola lectura de la sesión por pestaña");
    assert.strictEqual(auth.suscripciones, 1, "una sola suscripción a Supabase Auth");
});

prueba("TOKEN_REFRESHED y SIGNED_IN (misma cuenta) no notifican ni vuelven a «cargando»", async () => {
    const { auth, react, mod } = pestanaNueva();
    mod.useSesion();
    auth.resolverLectura(sesion("A"));
    await tick();
    const avisosAntes = react.montajes[0].avisos;
    auth.emitir("TOKEN_REFRESHED", sesion("A"));
    auth.emitir("SIGNED_IN", sesion("A"));
    auth.emitir("INITIAL_SESSION", sesion("A"));
    assert.strictEqual(react.montajes[0].avisos, avisosAntes);
    assert.strictEqual(mod.useSesion(), "con_sesion");
});

prueba("SIGNED_OUT -> sin_sesion (y avisa); instantáneas borradas", async () => {
    const { auth, react, mod } = pestanaNueva();
    mod.useSesion();
    auth.resolverLectura(sesion("A"));
    await tick();
    borradas.length = 0;
    auth.emitir("SIGNED_OUT", null);
    assert.strictEqual(mod.useSesion(), "sin_sesion");
    assert.ok(react.montajes[0].avisos > 0, "los componentes montados se enteran");
    assert.strictEqual(mod.usuarioSesionLocal(), null);
    assert.deepStrictEqual(borradas, [null]);
    // Nunca vuelve a «cargando» después de conocerse.
    auth.emitir("SIGNED_IN", sesion("A"));
    assert.strictEqual(mod.useSesion(), "con_sesion");
});

prueba("cambio de cuenta (otra pestaña): usuario nuevo fijado y instantánea anterior borrada", async () => {
    const { auth, mod } = pestanaNueva();
    mod.useSesion();
    auth.resolverLectura(sesion("A"));
    await tick();
    borradas.length = 0;
    auth.emitir("SIGNED_IN", sesion("B"));
    assert.strictEqual(mod.usuarioSesionLocal(), "B");
    assert.deepStrictEqual(borradas, ["B"], "borrarInstantaneas(B) deja solo las de B");
    assert.strictEqual(mod.useSesion(), "con_sesion");
});

prueba("lectura inicial desfasada (llega tras SIGNED_OUT) se descarta", async () => {
    const { auth, mod } = pestanaNueva();
    mod.useSesion();
    auth.emitir("SIGNED_OUT", null);
    auth.resolverLectura(sesion("A"));
    await tick();
    assert.strictEqual(mod.useSesion(), "sin_sesion");
    assert.strictEqual(mod.usuarioSesionLocal(), null);
});

prueba("sin sesión al arrancar -> sin_sesion", async () => {
    const { auth, mod } = pestanaNueva();
    mod.useSesion();
    auth.resolverLectura(null);
    await tick();
    assert.strictEqual(mod.useSesion(), "sin_sesion");
});

// --- lib/navegacion.ts -------------------------------------------------------
const nav = cargarTs(path.join(FRONT, "lib/navegacion.ts"), {});

prueba("RUTA_INICIO es Reservas (/tablas)", () => {
    assert.strictEqual(nav.RUTA_INICIO, "/tablas");
});

prueba("volver: acepta rutas internas del panel (con consulta y ancla)", () => {
    for (const ok of ["/tablas", "/tablas/5000", "/eventos", "/sorteos?sorteo=abc", "/mi-cuenta/pagos", "/aprende/tablas-de-precio#x", "/sesiones", "/automatizacion/grupos/123"]) {
        assert.strictEqual(nav.rutaVolverSegura(ok), ok, ok);
    }
});

prueba("volver: rechaza destinos externos, de autenticación y manipulados", () => {
    const malos = [
        null, undefined, "", "tablas", "//evil.com", "//evil.com/tablas", "/\\evil.com", "\\\\evil.com",
        "https://evil.com", "http://localhost/tablas", "javascript:alert(1)", "data:text/html,x",
        "/login", "/register", "/app", "/", "/recuperar-contrasena", "/restablecer-contrasena", "/conectar/abc",
        "/analitica-privada", "/api/tablas", "/tablasx", "/tablas/../login", "/tablas/%2e%2e/login",
        "/tablas\nSet-Cookie:x", "/tablas\t", "/" + "a".repeat(600), "/%2F%2Fevil.com"
    ];
    for (const m of malos) assert.strictEqual(nav.rutaVolverSegura(m), null, String(m));
});

prueba("destinoTrasLogin: ?volver válido o Reservas", () => {
    assert.strictEqual(nav.destinoTrasLogin("?volver=%2Feventos"), "/eventos");
    assert.strictEqual(nav.destinoTrasLogin("?volver=%2F%2Fevil.com"), "/tablas");
    assert.strictEqual(nav.destinoTrasLogin("?volver=https%3A%2F%2Fevil.com"), "/tablas");
    assert.strictEqual(nav.destinoTrasLogin("?clave=actualizada"), "/tablas");
    assert.strictEqual(nav.destinoTrasLogin(""), "/tablas");
});

prueba("loginConVolver: conserva la página privada; inicio o inválida -> /login", () => {
    assert.strictEqual(nav.loginConVolver("/eventos?sorteo=1"), "/login?volver=%2Feventos%3Fsorteo%3D1");
    assert.strictEqual(nav.loginConVolver("/tablas"), "/login");
    assert.strictEqual(nav.loginConVolver("/login"), "/login");
    assert.strictEqual(nav.destinoTrasLogin("?" + nav.loginConVolver("/eventos?sorteo=1").split("?")[1]), "/eventos?sorteo=1");
});

prueba("puntos de entrada: ninguno manda a /sesiones fijo; usan RUTA_INICIO", () => {
    const entradas = [
        "components/auth/EntradaApp.tsx", "components/auth/LoginForm.tsx", "components/auth/RegisterForm.tsx",
        "components/landing/RedireccionAppInstalada.tsx", "app/dashboard/page.tsx", "components/aprende/CentroAprendizaje.tsx"
    ];
    for (const r of entradas) {
        const src = leer(r);
        assert.ok(!/(replace|push|redirect)\(\s*"\/sesiones"/.test(src), `${r} redirige a /sesiones`);
        assert.ok(/RUTA_INICIO|destinoTrasLogin/.test(src), `${r} no usa RUTA_INICIO`);
    }
    const guardia = leer("components/layout/DashboardLayout/DashboardLayout.tsx");
    assert.ok(/sesion==="sin_sesion"[\s\S]*router\.replace\(loginConVolver\(/.test(guardia), "la guardia sigue mandando a /login");
    assert.ok(/if\(sesion!=="con_sesion"\)\{\s*return <PantallaCarga\/>/.test(guardia), "sin sesión confirmada no se muestra el panel");
});

let fallos = 0;
for (const { n, fn } of pruebas) {
    try { await fn(); console.log(`  OK    ${n}`); }
    catch (e) { fallos++; console.log(`  FALLO ${n}\n        → ${e.message}`); }
}
console.log(`\n${pruebas.length - fallos}/${pruebas.length} correctos`);
process.exit(fallos ? 1 : 0);
