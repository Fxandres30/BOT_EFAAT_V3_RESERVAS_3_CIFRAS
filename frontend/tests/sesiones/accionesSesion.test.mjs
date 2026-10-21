// ==========================================================================
// PRUEBAS — Acciones sobre sesiones de WhatsApp desde el panel (Fase A).
//
//   1. llamarBot (servidor del panel -> bot): 503, 401, 404, 409, JSON
//      válido no-objeto, respuesta no JSON, error de red y tiempo agotado.
//   2. reenviarAlBot: mantiene el token de servicio y la sesión del usuario
//      y nunca escribe el token en el log.
//   3. ejecutarAccionSesion (navegador -> panel): cada fallo vuelve como
//      resultado con un mensaje claro; nunca lanza ni espera para siempre.
//   4. crearControlAccion: «Procesando…» SIEMPRE termina (error, confirmación
//      o espera vencida), un doble clic no duplica y se puede reintentar.
//   5. Ninguna ruta del panel que espera al bot queda sin límite de espera.
//
// Sin red real: fetch simulado. El token de prueba es un valor ficticio.
//
//     node frontend/tests/sesiones/accionesSesion.test.mjs
// ==========================================================================

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const FRONT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const ts = require(path.join(FRONT, "node_modules/typescript"));

// ------------------------------------------------------- dobles de prueba ---

// NextResponse mínimo: lo que reenviarAlBot necesita.
const NextResponse = {
    json: (cuerpo, init = {}) => ({ cuerpo, status: init.status ?? 200, headers: init.headers || {} })
};

let fetchConSesionFalso = async () => { throw new TypeError("fetch failed"); };

function cargarTs(rutaAbs, cache = new Map()) {

    if (cache.has(rutaAbs)) return cache.get(rutaAbs).exports;

    const { outputText } = ts.transpileModule(fs.readFileSync(rutaAbs, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
    });

    const modulo = { exports: {} };
    cache.set(rutaAbs, modulo);

    const requerir = (spec) => {
        if (spec === "next/server") return { NextResponse };
        if (spec === "@/lib/fetchConSesion") return { fetchConSesion: (...a) => fetchConSesionFalso(...a) };
        if (spec.startsWith("node:")) return require(spec);
        const base = spec.startsWith("@/") ? path.join(FRONT, spec.slice(2)) : path.resolve(path.dirname(rutaAbs), spec);
        for (const ext of [".ts", ".tsx"]) {
            if (fs.existsSync(base + ext)) return cargarTs(base + ext, cache);
        }
        return require(spec);
    };

    new Function("module", "exports", "require", outputText)(modulo, modulo.exports, requerir);

    return modulo.exports;

}

// Respuesta HTTP simulada.
function respuesta(status, cuerpo) {
    const texto = typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo);
    return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => texto,
        json: async () => JSON.parse(texto)
    };
}

// fetch que nunca responde, pero respeta la señal de cancelación (como el real).
function fetchColgado(_url, init = {}) {
    return new Promise((_, rechazar) => {
        init.signal?.addEventListener("abort", () => rechazar(init.signal.reason));
    });
}

const fetchRed = async () => { throw new TypeError("fetch failed"); };

// ----------------------------------------------------------------- runner ---

// AbortSignal.timeout usa un temporizador que no mantiene vivo el proceso:
// sin esto, Node terminaría antes de que venza el límite en las pruebas de
// «sin respuesta» (en el servidor real siempre hay actividad).
const mantenerVivo = setInterval(() => {}, 1000);

let ok = 0;
let falla = 0;

async function prueba(nombre, fn) {
    try {
        await fn();
        ok++;
        console.log(`✅ ${nombre}`);
    } catch (err) {
        falla++;
        console.log(`❌ ${nombre}\n   ${err.message}`);
    }
}

const { llamarBot } = cargarTs(path.join(FRONT, "lib/llamarBot.ts"));
const { ejecutarAccionSesion, mensajeErrorAccion } = cargarTs(path.join(FRONT, "services/sessions/accionSesion.ts"));
const { crearControlAccion, AVISO_SIN_CONFIRMACION } = cargarTs(path.join(FRONT, "services/sessions/controlAccionSesion.ts"));

// ------------------------------------------------------------ 1. llamarBot ---

const CASOS_BOT = [
    ["503 sin token de servicio", 503, { success: false, code: "TOKEN_SERVICIO_NO_CONFIGURADO" }, 503, "TOKEN_SERVICIO_NO_CONFIGURADO"],
    ["401 token distinto", 401, { success: false, code: "NO_AUTORIZADO" }, 401, "NO_AUTORIZADO"],
    ["401 sesión de usuario vencida", 401, { ok: false, motivo: "sesion_invalida" }, 401, null],
    ["404 sesión ajena o inexistente", 404, { success: false, error: "Sesión no encontrada." }, 404, null],
    ["409 sesión en otro servidor", 409, { success: false, code: "LEASE_NO_DISPONIBLE" }, 409, "LEASE_NO_DISPONIBLE"]
];

for (const [nombre, status, cuerpo, esperado, code] of CASOS_BOT) {
    await prueba(`llamarBot: ${nombre} -> se devuelve tal cual (${esperado})`, async () => {
        const r = await llamarBot("http://bot.test/x", {}, { fetchImpl: async () => respuesta(status, cuerpo) });
        assert.strictEqual(r.status, esperado);
        if (code) assert.strictEqual(r.cuerpo.code, code);
    });
}

await prueba("llamarBot: JSON null (sin sesión activa) es una respuesta válida", async () => {
    const r = await llamarBot("http://bot.test/x", {}, { fetchImpl: async () => respuesta(200, "null") });
    assert.deepStrictEqual([r.status, r.cuerpo], [200, null]);
});

await prueba("llamarBot: respuesta no JSON -> RESPUESTA_INVALIDA (502 si era 200)", async () => {
    const r = await llamarBot("http://bot.test/x", {}, { fetchImpl: async () => respuesta(200, "<html>proxy</html>") });
    assert.deepStrictEqual([r.status, r.cuerpo.code], [502, "RESPUESTA_INVALIDA"]);
    const r2 = await llamarBot("http://bot.test/x", {}, { fetchImpl: async () => respuesta(500, "Internal Server Error") });
    assert.deepStrictEqual([r2.status, r2.cuerpo.code], [500, "RESPUESTA_INVALIDA"]);
});

await prueba("llamarBot: bot inalcanzable -> 502 BOT_NO_DISPONIBLE (no lanza)", async () => {
    const r = await llamarBot("http://bot.test/x", {}, { fetchImpl: fetchRed });
    assert.deepStrictEqual([r.status, r.cuerpo.code], [502, "BOT_NO_DISPONIBLE"]);
});

await prueba("llamarBot: el bot no responde -> 504 BOT_SIN_RESPUESTA al vencer el límite", async () => {
    const inicio = Date.now();
    const r = await llamarBot("http://bot.test/x", {}, { fetchImpl: fetchColgado, timeoutMs: 50 });
    assert.deepStrictEqual([r.status, r.cuerpo.code], [504, "BOT_SIN_RESPUESTA"]);
    assert.ok(Date.now() - inicio < 2000, "termina cerca del límite, no espera de más");
});

// ------------------------------------------------------- 2. reenviarAlBot ---

await prueba("reenviarAlBot: envía token de servicio y sesión del usuario; el log nunca muestra el token", async () => {
    const TOKEN_FICTICIO = "token-de-prueba-ficticio-123";
    process.env.BOT_API_TOKEN = TOKEN_FICTICIO;
    process.env.BOT_API_URL = "http://bot.test";
    const { reenviarAlBot } = cargarTs(path.join(FRONT, "lib/botApi.ts"));
    const recibidas = [];
    const fetchOriginal = globalThis.fetch;
    const errorOriginal = console.error;
    const logs = [];
    globalThis.fetch = async (url, init) => { recibidas.push({ url, headers: init.headers }); return respuesta(503, { success: false, code: "TOKEN_SERVICIO_NO_CONFIGURADO" }); };
    console.error = (...a) => logs.push(a.join(" "));
    try {
        const req = new Request("http://panel.test/api/sessions/connect", { headers: { authorization: "Bearer jwt-usuario" } });
        const r = await reenviarAlBot(req, "/sessions/connect", { metodo: "POST", cuerpo: { sessionId: "s1" } });
        assert.strictEqual(r.status, 503);
        assert.strictEqual(recibidas[0].url, "http://bot.test/sessions/connect");
        assert.strictEqual(recibidas[0].headers["x-service-token"], TOKEN_FICTICIO);
        assert.strictEqual(recibidas[0].headers.Authorization, "Bearer jwt-usuario");
        assert.ok(logs.length === 1 && logs[0].includes("503") && logs[0].includes("TOKEN_SERVICIO_NO_CONFIGURADO"));
        assert.ok(!logs.join(" ").includes(TOKEN_FICTICIO) && !logs.join(" ").includes("jwt-usuario"), "el log no contiene secretos");
    } finally {
        globalThis.fetch = fetchOriginal;
        console.error = errorOriginal;
        delete process.env.BOT_API_TOKEN;
        delete process.env.BOT_API_URL;
    }
});

// ------------------------------------------------- 3. ejecutarAccionSesion ---

const CASOS_ACCION = [
    ["503 sin token", respuesta(503, { code: "TOKEN_SERVICIO_NO_CONFIGURADO" }), "TOKEN_SERVICIO_NO_CONFIGURADO", /soporte técnico/],
    ["401 sesión vencida", respuesta(401, { motivo: "sesion_invalida" }), "sesion_invalida", /iniciar sesión/],
    ["404 sin código", respuesta(404, { error: "Sesión no encontrada." }), "NO_ENCONTRADA", /ya no existe/],
    ["404 SESSION_NOT_FOUND", respuesta(404, { success: false, code: "SESSION_NOT_FOUND" }), "SESSION_NOT_FOUND", /ya no existe/],
    ["409 otro servidor", respuesta(409, { code: "LEASE_NO_DISPONIBLE" }), "LEASE_NO_DISPONIBLE", /otro servidor/],
    ["504 del proxy", respuesta(504, { code: "BOT_SIN_RESPUESTA" }), "BOT_SIN_RESPUESTA", /tardó demasiado/],
    ["502 del proxy", respuesta(502, { code: "BOT_NO_DISPONIBLE" }), "BOT_NO_DISPONIBLE", /no está disponible/],
    ["200 con success:false", respuesta(200, { success: false, code: "SESSION_NOT_FOUND" }), "SESSION_NOT_FOUND", /ya no existe/],
    ["500 no JSON", respuesta(500, "Internal Server Error"), "HTTP_500", /error 500/]
];

for (const [nombre, res, code, mensaje] of CASOS_ACCION) {
    await prueba(`acción: ${nombre} -> resultado con mensaje claro`, async () => {
        const r = await ejecutarAccionSesion("/api/sessions/connect", "s1", { fetchImpl: async () => res });
        assert.deepStrictEqual([r.ok, r.code], [false, code]);
        assert.match(r.mensaje, mensaje);
    });
}

await prueba("acción: error de red del navegador -> RED, no lanza", async () => {
    const r = await ejecutarAccionSesion("/api/sessions/connect", "s1", { fetchImpl: fetchRed });
    assert.deepStrictEqual([r.ok, r.code], [false, "RED"]);
    assert.match(r.mensaje, /conexión/);
});

await prueba("acción: el panel no responde -> TIEMPO_AGOTADO al vencer el límite", async () => {
    const r = await ejecutarAccionSesion("/api/sessions/connect", "s1", { fetchImpl: fetchColgado, timeoutMs: 50 });
    assert.deepStrictEqual([r.ok, r.code], [false, "TIEMPO_AGOTADO"]);
});

await prueba("acción: éxito -> ok:true; envía solo el sessionId", async () => {
    let cuerpo = null;
    const r = await ejecutarAccionSesion("/api/sessions/connect", "s1", { fetchImpl: async (_u, init) => { cuerpo = JSON.parse(init.body); return respuesta(200, { success: true, sessionId: "s1" }); } });
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(cuerpo, { sessionId: "s1" });
});

await prueba("mensajes: nunca incluyen nombres de variables ni valores de configuración", () => {
    for (const code of ["TOKEN_SERVICIO_NO_CONFIGURADO", "NO_AUTORIZADO", "BOT_NO_DISPONIBLE"]) {
        assert.ok(!/TOKEN|SESSIONS_API|BOT_API/.test(mensajeErrorAccion(503, code)), code);
    }
});

// ------------------------------------------------ 4. crearControlAccion ---

function controlConReloj() {
    const estados = [];
    let pendiente = null;
    const c = crearControlAccion({
        alCambiar: (e) => estados.push(e),
        esperaConfirmacionMs: 45000,
        programar: (fn) => { pendiente = fn; return 1; },
        cancelar: () => { pendiente = null; }
    });
    return { c, estados, vencer: () => { const fn = pendiente; pendiente = null; fn?.(); }, hayTemporizador: () => pendiente !== null };
}

const ERROR = { ok: false, status: 503, code: "TOKEN_SERVICIO_NO_CONFIGURADO", mensaje: "sin servidor" };
const EXITO = { ok: true, status: 200, datos: {} };

await prueba("control: error -> deja de cargar al instante y muestra el mensaje", () => {
    const { c, estados } = controlConReloj();
    assert.strictEqual(c.iniciar(), true);
    c.resultado(ERROR);
    assert.deepStrictEqual(estados.at(-1), { cargando: false, error: "sin servidor", aviso: null });
});

await prueba("control: doble clic mientras carga -> no se inicia otra acción", () => {
    const { c } = controlConReloj();
    assert.strictEqual(c.iniciar(), true);
    assert.strictEqual(c.iniciar(), false);
});

await prueba("control: éxito + confirmación del bot -> deja de cargar sin aviso", () => {
    const { c, estados, hayTemporizador } = controlConReloj();
    c.iniciar();
    c.resultado(EXITO);
    assert.strictEqual(estados.at(-1).cargando, true, "sigue esperando la confirmación");
    c.confirmado();
    assert.deepStrictEqual(estados.at(-1), { cargando: false, error: null, aviso: null });
    assert.strictEqual(hayTemporizador(), false, "sin temporizadores vivos");
});

await prueba("control: éxito sin confirmación -> al vencer la espera deja de cargar con aviso", () => {
    const { c, estados, vencer } = controlConReloj();
    c.iniciar();
    c.resultado(EXITO);
    vencer();
    assert.deepStrictEqual(estados.at(-1), { cargando: false, error: null, aviso: AVISO_SIN_CONFIRMACION });
});

await prueba("control: después de terminar se puede reintentar", () => {
    const { c } = controlConReloj();
    c.iniciar();
    c.resultado(ERROR);
    assert.strictEqual(c.iniciar(), true);
});

await prueba("control: una confirmación tardía de otra acción no reabre nada", () => {
    const { c, estados } = controlConReloj();
    c.confirmado();
    assert.strictEqual(estados.length, 0);
});

// -------------------------------------- 5. ninguna ruta sin límite de espera ---

await prueba("rutas del panel hacia el bot: todas con límite de espera (reenviarAlBot o AbortSignal.timeout)", () => {
    const raiz = path.join(FRONT, "app/api");
    const rutas = [];
    (function recorrer(dir) {
        for (const nombre of fs.readdirSync(dir)) {
            const completo = path.join(dir, nombre);
            if (fs.statSync(completo).isDirectory()) recorrer(completo);
            else if (nombre === "route.ts") rutas.push(completo);
        }
    })(raiz);
    const sinLimite = rutas.filter(r => {
        const codigo = fs.readFileSync(r, "utf8");
        const llamaAlBot = /BOT_API_URL|botApiHeaders/.test(codigo) || codigo.includes("reenviarAlBot");
        return llamaAlBot && !codigo.includes("reenviarAlBot") && !codigo.includes("llamarBot") && !codigo.includes("AbortSignal.timeout");
    }).map(r => path.relative(FRONT, r));
    assert.deepStrictEqual(sinLimite, []);
});

clearInterval(mantenerVivo);

console.log(`\n${ok + falla} pruebas · ${ok} OK · ${falla} fallidas`);

process.exit(falla > 0 ? 1 : 0);
