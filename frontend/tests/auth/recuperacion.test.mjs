// ==========================================================================
// PRUEBAS (frontend) — recuperación de contraseña con Supabase Auth.
//
// Carga lib/auth/recuperacion.ts REAL transpilándolo con el TypeScript del
// proyecto (mismo método que seguridadContrasena.test.mjs). Supabase Auth es
// un doble en memoria: sin red ni Supabase real. Los tokens son ficticios.
//
//     node frontend/tests/auth/recuperacion.test.mjs
// ==========================================================================

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const FRONT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const ts = require(path.join(FRONT, "node_modules/typescript"));

function cargarTs(relativa) {
    const fuente = fs.readFileSync(path.join(FRONT, relativa), "utf8");
    const { outputText } = ts.transpileModule(fuente, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    });
    const modulo = { exports: {} };
    new Function("module", "exports", "require", outputText)(modulo, modulo.exports, () => {
        throw new Error(`${relativa} no debe importar nada`);
    });
    return modulo.exports;
}

const leer = (relativa) => fs.readFileSync(path.join(FRONT, relativa), "utf8");

const R = cargarTs("lib/auth/recuperacion.ts");

const TOKEN = "token-ficticio-del-enlace";
const ORIGEN = "https://panel.ejemplo.test";

// Doble de supabase.auth: registra llamadas y devuelve lo configurado.
function authFalso(conf = {}) {
    const llamadas = [];
    return {
        llamadas,
        async resetPasswordForEmail(email, opciones) {
            llamadas.push(["reset", email, opciones]);
            if (conf.resetLanza) throw conf.resetLanza;
            return { data: {}, error: conf.resetError ?? null };
        },
        async getSession() {
            llamadas.push(["getSession"]);
            return { data: { session: conf.sesion ?? null }, error: conf.sesionError ?? null };
        },
        async verifyOtp(p) {
            llamadas.push(["verifyOtp", p]);
            if (!conf.verifyError && conf.sesionTrasVerificar) conf.sesion = conf.sesionTrasVerificar;
            return { data: {}, error: conf.verifyError ?? null };
        },
        async updateUser(c) {
            llamadas.push(["updateUser", c]);
            if (conf.updateLanza) throw conf.updateLanza;
            return { data: {}, error: conf.updateError ?? null };
        }
    };
}

const red = { name: "AuthRetryableFetchError", status: 0, message: "Failed to fetch" };

// Captura console.warn para comprobar que nunca aparece nada sensible.
const avisos = [];
const warnOriginal = console.warn;
console.warn = (...a) => avisos.push(a.join(" "));

let ok = 0;
async function prueba(nombre, fn) {
    await fn();
    ok++;
    warnOriginal(`  ✔ ${nombre}`);
}

warnOriginal("recuperacion");

// ----------------------------------------------------------- redirección ---

await prueba("redirección: siempre al ORIGEN de la página + /restablecer-contrasena", () => {
    assert.strictEqual(R.urlRestablecer(ORIGEN), `${ORIGEN}/restablecer-contrasena`);
    assert.strictEqual(R.urlRestablecer("http://localhost:3000"), "http://localhost:3000/restablecer-contrasena");
});

await prueba("redirección: rechaza esquemas, rutas, credenciales y basura (sin redirección abierta)", () => {
    for (const malo of ["javascript:alert(1)", "data:text/html,x", "https://evil.test/ruta", "https://u:p@evil.test", "//evil.test", "", "no es url"]) {
        assert.strictEqual(R.urlRestablecer(malo), null, malo);
    }
});

// ---------------------------------------------------------------- enlace ---

await prueba("enlace: flujo implícito por defecto (#access_token&type=recovery)", () => {
    const e = R.leerEnlaceRecuperacion(`${ORIGEN}/restablecer-contrasena#access_token=${TOKEN}&refresh_token=r&expires_in=3600&token_type=bearer&type=recovery`);
    assert.deepStrictEqual(e, { tipo: "implicito", accessToken: TOKEN });
});

await prueba("enlace: plantilla con token_hash (?token_hash&type=recovery)", () => {
    assert.deepStrictEqual(R.leerEnlaceRecuperacion(`${ORIGEN}/restablecer-contrasena?token_hash=abc&type=recovery`), { tipo: "token_hash", tokenHash: "abc" });
});

await prueba("enlace caducado o usado: error_code en el hash o en la consulta", () => {
    const hash = R.leerEnlaceRecuperacion(`${ORIGEN}/restablecer-contrasena#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`);
    assert.deepStrictEqual(hash, { tipo: "error", codigo: "otp_expired" });
    assert.deepStrictEqual(R.leerEnlaceRecuperacion(`${ORIGEN}/x?error=access_denied`), { tipo: "error", codigo: "access_denied" });
    assert.deepStrictEqual(R.leerEnlaceRecuperacion(`${ORIGEN}/x?error_description=algo`), { tipo: "error", codigo: "desconocido" });
});

await prueba("enlace: otro tipo (registro, ?code=, sin parámetros) NO habilita el cambio", () => {
    assert.strictEqual(R.leerEnlaceRecuperacion(`${ORIGEN}/x#access_token=${TOKEN}&type=signup`).tipo, "ninguno");
    assert.strictEqual(R.leerEnlaceRecuperacion(`${ORIGEN}/x?code=123`).tipo, "ninguno");
    assert.strictEqual(R.leerEnlaceRecuperacion(`${ORIGEN}/restablecer-contrasena`).tipo, "ninguno");
    assert.strictEqual(R.leerEnlaceRecuperacion("::::").tipo, "ninguno");
});

await prueba("la URL queda sin tokens ni códigos de error", () => {
    const limpia = R.urlSinDatosDeEnlace(`${ORIGEN}/restablecer-contrasena?token_hash=abc&type=recovery&otro=1#access_token=${TOKEN}`);
    assert.strictEqual(limpia, `${ORIGEN}/restablecer-contrasena?otro=1`);
    assert.ok(!limpia.includes(TOKEN));
});

await prueba("enlace en otra página (fallback al Site URL): se reenvía a /restablecer-contrasena intacto", () => {
    const hash = `#access_token=${TOKEN}&expires_in=3600&refresh_token=r&token_type=bearer&type=recovery`;
    assert.strictEqual(R.destinoEnlaceRecuperacion(`${ORIGEN}/${hash}`), `${ORIGEN}/restablecer-contrasena${hash}`);
    assert.strictEqual(R.destinoEnlaceRecuperacion(`${ORIGEN}/login${hash}`), `${ORIGEN}/restablecer-contrasena${hash}`);
    assert.strictEqual(R.destinoEnlaceRecuperacion(`${ORIGEN}/?token_hash=abc&type=recovery`), `${ORIGEN}/restablecer-contrasena?token_hash=abc&type=recovery`);
    // Ya en su sitio, otro tipo de enlace, sin enlace o basura: nada.
    assert.strictEqual(R.destinoEnlaceRecuperacion(`${ORIGEN}/restablecer-contrasena${hash}`), null);
    assert.strictEqual(R.destinoEnlaceRecuperacion(`${ORIGEN}/restablecer-contrasena/${hash}`), null);
    assert.strictEqual(R.destinoEnlaceRecuperacion(`${ORIGEN}/login#access_token=${TOKEN}&type=signup`), null);
    assert.strictEqual(R.destinoEnlaceRecuperacion(`${ORIGEN}/sesiones`), null);
    assert.strictEqual(R.destinoEnlaceRecuperacion("no es una url"), null);
    // Siempre el mismo origen.
    assert.ok(R.destinoEnlaceRecuperacion(`https://otro.test/x${hash}`).startsWith("https://otro.test/restablecer-contrasena"));
});

// ------------------------------------------------------------- solicitar ---

await prueba("solicitud: llama a resetPasswordForEmail con el correo limpio y la redirección segura", async () => {
    const auth = authFalso();
    assert.deepStrictEqual(await R.solicitarRecuperacion(auth, "  ana@correo.test ", ORIGEN), { ok: true });
    assert.deepStrictEqual(auth.llamadas, [["reset", "ana@correo.test", { redirectTo: `${ORIGEN}/restablecer-contrasena` }]]);
});

await prueba("solicitud: correo con formato inválido -> no llama a Supabase", async () => {
    const auth = authFalso();
    for (const c of ["", "ana", "ana@", "a b@c.d"]) {
        assert.deepStrictEqual(await R.solicitarRecuperacion(auth, c, ORIGEN), { ok: false, motivo: "correo_invalido" });
    }
    assert.strictEqual(auth.llamadas.length, 0);
});

await prueba("solicitud: no revela si el correo existe (un error de 'usuario' se presenta como éxito)", async () => {
    // El fallo del SMTP solo ocurre si la cuenta EXISTE (sin cuenta no se envía
    // nada): mostrarlo delataría el correo. Queda en el log de Supabase Auth.
    const smtp = { name: "AuthApiError", status: 500, code: "unexpected_failure", message: "Error sending recovery email" };
    for (const error of [{ code: "user_not_found", status: 400 }, { name: "AuthApiError", status: 500 }, smtp]) {
        assert.deepStrictEqual(await R.solicitarRecuperacion(authFalso({ resetError: error }), "nadie@correo.test", ORIGEN), { ok: true });
    }
});

await prueba("solicitud: límite de envíos, error de red (devuelto o lanzado) y origen inválido", async () => {
    assert.deepStrictEqual(await R.solicitarRecuperacion(authFalso({ resetError: { code: "over_email_send_rate_limit", status: 429 } }), "a@b.co", ORIGEN), { ok: false, motivo: "limite" });
    assert.deepStrictEqual(await R.solicitarRecuperacion(authFalso({ resetError: red }), "a@b.co", ORIGEN), { ok: false, motivo: "red" });
    assert.deepStrictEqual(await R.solicitarRecuperacion(authFalso({ resetLanza: new TypeError("fetch failed") }), "a@b.co", ORIGEN), { ok: false, motivo: "red" });
    const auth = authFalso();
    assert.deepStrictEqual(await R.solicitarRecuperacion(auth, "a@b.co", "javascript:x"), { ok: false, motivo: "configuracion" });
    assert.strictEqual(auth.llamadas.length, 0);
    for (const m of ["correo_invalido", "limite", "red", "configuracion"]) assert.ok(R.mensajeSolicitud(m).length > 10);
});

// ------------------------------------------------------- verificar enlace ---

await prueba("verificación implícita: válida solo si la sesión es la DEL ENLACE", async () => {
    const enlace = { tipo: "implicito", accessToken: TOKEN };
    const valida = await R.verificarEnlace(authFalso({ sesion: { access_token: TOKEN, user: { email: "ana@correo.test" } } }), enlace);
    assert.deepStrictEqual(valida, { ok: true, correo: "ana@correo.test" });
    // El enlace falló y supabase-js conservó una sesión anterior: NO vale.
    const otra = await R.verificarEnlace(authFalso({ sesion: { access_token: "sesion-anterior" } }), enlace);
    assert.deepStrictEqual(otra, { ok: false, motivo: "caducado" });
    assert.deepStrictEqual(await R.verificarEnlace(authFalso(), enlace), { ok: false, motivo: "caducado" });
});

await prueba("verificación token_hash: verifyOtp(recovery) y luego la sesión", async () => {
    const auth = authFalso({ sesionTrasVerificar: { access_token: "nuevo", user: { email: "ana@correo.test" } } });
    assert.deepStrictEqual(await R.verificarEnlace(auth, { tipo: "token_hash", tokenHash: "abc" }), { ok: true, correo: "ana@correo.test" });
    assert.deepStrictEqual(auth.llamadas[0], ["verifyOtp", { type: "recovery", token_hash: "abc" }]);
});

await prueba("verificación: enlace caducado, inválido, ya usado, sin enlace y error de red", async () => {
    assert.deepStrictEqual(await R.verificarEnlace(authFalso({ verifyError: { code: "otp_expired", status: 403 } }), { tipo: "token_hash", tokenHash: "x" }), { ok: false, motivo: "caducado" });
    assert.deepStrictEqual(await R.verificarEnlace(authFalso({ verifyError: { code: "validation_failed", status: 400 } }), { tipo: "token_hash", tokenHash: "x" }), { ok: false, motivo: "invalido" });
    assert.deepStrictEqual(await R.verificarEnlace(authFalso({ verifyError: red }), { tipo: "token_hash", tokenHash: "x" }), { ok: false, motivo: "red" });
    assert.deepStrictEqual(await R.verificarEnlace(authFalso({ sesion: { access_token: TOKEN } }), { tipo: "error", codigo: "otp_expired" }), { ok: false, motivo: "caducado" });
    assert.deepStrictEqual(await R.verificarEnlace(authFalso(), { tipo: "error", codigo: "raro" }), { ok: false, motivo: "invalido" });
    // Con sesión iniciada pero sin enlace: no se permite cambiar la contraseña.
    const auth = authFalso({ sesion: { access_token: TOKEN } });
    assert.deepStrictEqual(await R.verificarEnlace(auth, { tipo: "ninguno" }), { ok: false, motivo: "sin_enlace" });
    assert.strictEqual(auth.llamadas.length, 0);
    for (const m of ["caducado", "invalido", "sin_enlace", "red"]) assert.ok(R.mensajeEnlace(m).length > 10);
});

// ------------------------------------------------------- nueva contraseña ---

await prueba("validación: vacías, corta, débil y no coincidentes", () => {
    assert.match(R.validarNuevaContrasena("", "", true, 8), /Escribe/);
    assert.match(R.validarNuevaContrasena("Ab1!", "Ab1!", true, 8), /al menos 8/);
    assert.match(R.validarNuevaContrasena("password1", "password1", false, 8), /fácil de adivinar/);
    assert.strictEqual(R.validarNuevaContrasena("Río-Verde-Lámpara-82", "Río-Verde-Lámpara-28", true, 8), "Las contraseñas no coinciden.");
    assert.strictEqual(R.validarNuevaContrasena("Río-Verde-Lámpara-82", "Río-Verde-Lámpara-82", true, 8), null);
});

await prueba("actualización correcta: updateUser({ password })", async () => {
    const auth = authFalso();
    assert.deepStrictEqual(await R.actualizarContrasena(auth, "Río-Verde-Lámpara-82"), { ok: true });
    assert.deepStrictEqual(auth.llamadas, [["updateUser", { password: "Río-Verde-Lámpara-82" }]]);
});

await prueba("actualización: misma contraseña, débil, sesión vencida, red y error desconocido", async () => {
    const caso = async (conf) => (await R.actualizarContrasena(authFalso(conf), "Río-Verde-Lámpara-82")).motivo;
    assert.strictEqual(await caso({ updateError: { code: "same_password", status: 422 } }), "misma");
    assert.strictEqual(await caso({ updateError: { name: "AuthWeakPasswordError", code: "weak_password", status: 422 } }), "debil");
    assert.strictEqual(await caso({ updateError: { name: "AuthSessionMissingError", status: 400 } }), "enlace");
    assert.strictEqual(await caso({ updateError: { code: "session_not_found", status: 403 } }), "enlace");
    assert.strictEqual(await caso({ updateError: red }), "red");
    assert.strictEqual(await caso({ updateLanza: new TypeError("fetch failed") }), "red");
    assert.strictEqual(await caso({ updateError: { name: "AuthApiError", status: 500, code: "unexpected_failure" } }), "otro");
});

await prueba("los avisos del log nunca contienen contraseñas, tokens ni correos", () => {
    const todo = avisos.join("\n");
    for (const sensible of ["Río-Verde-Lámpara-82", TOKEN, "@correo.test", "a@b.co"]) assert.ok(!todo.includes(sensible), sensible);
});

// ------------------------------------------------- pantallas (estático) ---

await prueba("pantallas: enlace en el login, rutas creadas y cliente Supabase único", () => {
    const login = leer("components/auth/LoginForm.tsx");
    assert.ok(login.includes('href="/recuperar-contrasena"') && login.includes("¿Olvidaste tu contraseña?"));
    assert.ok(fs.existsSync(path.join(FRONT, "app/recuperar-contrasena/page.tsx")));
    assert.ok(fs.existsSync(path.join(FRONT, "app/restablecer-contrasena/page.tsx")));
    for (const f of ["components/auth/RecuperarContrasenaForm.tsx", "components/auth/RestablecerContrasenaForm.tsx"]) {
        const src = leer(f);
        assert.ok(src.includes('from "@/lib/supabase"'), `${f} usa el cliente único`);
        assert.ok(!/createClient|SERVICE_ROLE|console\.log/.test(src), `${f} sin cliente propio, clave de servicio ni logs`);
    }
    // La redirección sale del origen de la página, nunca de un parámetro.
    const solicitar = leer("components/auth/RecuperarContrasenaForm.tsx");
    assert.ok(solicitar.includes("window.location.origin") && !/searchParams|redirect=|next=/.test(solicitar));
    // El enlace se lee al cargar el módulo, antes de que supabase-js limpie el hash.
    assert.match(leer("components/auth/RestablecerContrasenaForm.tsx"), /^const ENLACE_INICIAL = typeof window/m);
    // Flujo implícito (por defecto): el enlace sirve en otro dispositivo. PKCE
    // exigiría el code_verifier del navegador que pidió el correo.
    const cliente = leer("lib/supabase.ts");
    assert.ok(!/flowType/.test(cliente), "sin flowType: implícito");
    assert.ok(cliente.includes("detectSessionInUrl") && cliente.includes("destinoEnlaceRecuperacion"));
    assert.ok(leer("app/layout.tsx").includes("<ReenvioRecuperacion />"));
});

console.warn = warnOriginal;
console.log(`\n${ok} pruebas OK`);
