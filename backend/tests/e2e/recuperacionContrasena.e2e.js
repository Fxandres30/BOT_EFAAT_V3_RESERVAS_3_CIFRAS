// ==========================================================================
// PRUEBA DE NAVEGADOR — recuperación de contraseña del panel.
//
// Chrome (puppeteer) + panel real (`next dev`) + supabase-js REAL del panel
// contra un Supabase Auth FALSO local (GoTrue mínimo: /recover, /user,
// /verify, /logout). No toca Supabase ni envía correos; los tokens son
// ficticios. No usa backend del bot.
//
//     node backend/tests/e2e/recuperacionContrasena.e2e.js
// ==========================================================================

const assert = require("assert");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");

const FRONTEND = path.resolve(__dirname, "../../../frontend");
const PUERTO_SUPABASE = 54397;
const PUERTO_PANEL = 3102;
const PANEL = `http://127.0.0.1:${PUERTO_PANEL}`;

const USUARIO = { id: "aaaaaaaa-0000-4000-8000-00000000000a", aud: "authenticated", role: "authenticated", email: "ana@prueba.local", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
const TOKEN_RECUPERACION = "tok-recuperacion";
const TOKEN_ANTERIOR = "tok-sesion-anterior";
const TOKENS_VALIDOS = new Set([TOKEN_RECUPERACION, TOKEN_ANTERIOR, "tok-verificado"]);
const CLAVE_NUEVA = "Río-Verde-Lámpara-82";
const CLAVE_IGUAL = "Mismísima-Clave-Vieja-47";

const registro = [];
const CLAVE_ANTERIOR = "Clave-Anterior-Del-Usuario-31";
let claveActual = CLAVE_ANTERIOR;  // la que acepta /token (inicio de sesión)
let modoActualizacion = "ok";   // ok | sin_red

function servidorAuth() {
    const s = http.createServer((req, res) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Headers", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
        res.setHeader("Content-Type", "application/json");
        if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }

        let cuerpo = "";
        req.on("data", c => { cuerpo += c; });
        req.on("end", () => {
            const url = new URL(req.url, "http://x");
            const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
            const datos = cuerpo ? JSON.parse(cuerpo) : {};
            registro.push({ metodo: req.method, ruta: url.pathname, token, datos, redirectTo: url.searchParams.get("redirect_to") });

            if (url.pathname === "/auth/v1/recover") {
                if (datos.email === "limite@prueba.local") { res.writeHead(429); return res.end(JSON.stringify({ error_code: "over_email_send_rate_limit", msg: "rate limit" })); }
                return res.end("{}");
            }
            if (url.pathname === "/auth/v1/user" && req.method === "GET") {
                if (!TOKENS_VALIDOS.has(token)) { res.writeHead(401); return res.end(JSON.stringify({ error_code: "bad_jwt", msg: "invalid" })); }
                return res.end(JSON.stringify(USUARIO));
            }
            if (url.pathname === "/auth/v1/user" && req.method === "PUT") {
                if (modoActualizacion === "sin_red") return req.socket.destroy();
                if (datos.password === CLAVE_IGUAL) { res.writeHead(422); return res.end(JSON.stringify({ error_code: "same_password", msg: "New password should be different from the old password." })); }
                if (!TOKENS_VALIDOS.has(token)) { res.writeHead(401); return res.end(JSON.stringify({ error_code: "bad_jwt", msg: "invalid" })); }
                claveActual = datos.password;
                return res.end(JSON.stringify(USUARIO));
            }
            if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "password") {
                if (datos.email !== USUARIO.email || datos.password !== claveActual) { res.writeHead(400); return res.end(JSON.stringify({ error_code: "invalid_credentials", msg: "Invalid login credentials" })); }
                return res.end(JSON.stringify({ access_token: "tok-login", refresh_token: "r-login", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: USUARIO }));
            }
            if (url.pathname === "/auth/v1/verify") {
                if (datos.token_hash !== "hash-bueno") { res.writeHead(403); return res.end(JSON.stringify({ error_code: "otp_expired", msg: "Email link is invalid or has expired" })); }
                return res.end(JSON.stringify({ access_token: "tok-verificado", refresh_token: "r", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: USUARIO }));
            }
            if (url.pathname === "/auth/v1/logout") { res.writeHead(204); return res.end(); }
            res.end("{}");
        });
    });
    return new Promise(r => s.listen(PUERTO_SUPABASE, "127.0.0.1", () => r(s)));
}

function arrancarPanel() {
    const args = ["next", "dev", "-p", String(PUERTO_PANEL), "-H", "127.0.0.1"];
    const [cmd, argv] = process.platform === "win32" ? ["cmd.exe", ["/c", "npx", ...args]] : ["npx", args];
    const hijo = spawn(cmd, argv, {
        cwd: FRONTEND,
        env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${PUERTO_SUPABASE}`, NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-e2e", NEXT_TELEMETRY_DISABLED: "1" }
    });
    let salida = "";
    hijo.stdout.on("data", d => { salida += d; });
    hijo.stderr.on("data", d => { salida += d; });
    const listo = new Promise((res, rej) => {
        const limite = setTimeout(() => rej(new Error("next dev no arrancó:\n" + salida)), 180000);
        const mirar = setInterval(() => { if (/Ready|ready in|Local:/i.test(salida)) { clearInterval(mirar); clearTimeout(limite); res(); } }, 300);
    });
    return { hijo, listo, salida: () => salida };
}

const sesionGuardada = (token) => ({ access_token: token, refresh_token: `r-${token}`, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: USUARIO });

function hashRecuperacion(token) {
    const ahora = Math.floor(Date.now() / 1000);
    return `#access_token=${token}&expires_at=${ahora + 3600}&expires_in=3600&refresh_token=r-rec&token_type=bearer&type=recovery`;
}

async function esperarTexto(page, texto) {
    try {
        await page.waitForFunction((t) => document.body.innerText.includes(t), { timeout: 60000 }, texto);
    } catch {
        const visible = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 300)).catch(() => "?");
        throw new Error(`no apareció «${texto}». En pantalla: ${visible}`);
    }
}

async function escribir(page, aria, valor) {
    await page.evaluate((aria, valor) => {
        const el = document.querySelector(`[aria-label="${aria}"]`);
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, valor);
        el.dispatchEvent(new Event("input", { bubbles: true }));
    }, aria, valor);
}

const pulsar = (page, texto) => page.evaluate((t) => {
    const b = [...document.querySelectorAll("button, a")].find(x => x.textContent.trim() === t);
    if (!b) throw new Error(`no encontrado: ${t}`);
    b.click();
}, texto);

(async () => {

    const auth = await servidorAuth();
    const panel = arrancarPanel();
    let browser;
    let total = 0, fallos = 0;

    const cerrar = async () => {
        if (browser) await browser.close();
        // Se ESPERA al taskkill: si el proceso sale antes, `next dev` queda vivo.
        if (process.platform === "win32") await new Promise(r => spawn("taskkill", ["/pid", String(panel.hijo.pid), "/T", "/F"]).on("exit", r));
        else panel.hijo.kill("SIGTERM");
        auth.close();
    };

    async function pagina({ sesion } = {}) {
        const contexto = await browser.createBrowserContext();
        const page = await contexto.newPage();
        page.setDefaultTimeout(60000);
        page.erroresJs = [];
        page.consola = [];
        page.on("pageerror", e => page.erroresJs.push(e.message));
        page.on("console", m => page.consola.push(m.text()));
        if (sesion) await page.evaluateOnNewDocument((s) => localStorage.setItem("sb-127-auth-token", JSON.stringify(s)), sesion);
        return page;
    }

    async function prueba(nombre, fn) {
        total++;
        try { await fn(); console.log("✅", nombre); } catch (e) { fallos++; console.log("❌", nombre, "\n   ", e.message); }
    }

    try {
        await panel.listo;
        browser = await require("puppeteer").launch({ headless: true });

        await prueba("login muestra «¿Olvidaste tu contraseña?» y lleva a la solicitud", async () => {
            const page = await pagina();
            await page.goto(`${PANEL}/login`);
            await esperarTexto(page, "¿Olvidaste tu contraseña?");
            await pulsar(page, "¿Olvidaste tu contraseña?");
            await page.waitForFunction(() => location.pathname === "/recuperar-contrasena");
            await esperarTexto(page, "Recuperar contraseña");
        });

        await prueba("solicitud: correo inválido no llama a Supabase; válido muestra confirmación genérica y redirige a /restablecer-contrasena", async () => {
            const page = await pagina();
            await page.goto(`${PANEL}/recuperar-contrasena`);
            await esperarTexto(page, "Enviar enlace");
            const antes = registro.length;
            await escribir(page, "Correo", "no-es-correo");
            await pulsar(page, "Enviar enlace");
            await esperarTexto(page, "Escribe un correo válido.");
            assert.strictEqual(registro.slice(antes).filter(r => r.ruta === "/auth/v1/recover").length, 0);
            await escribir(page, "Correo", "ana@prueba.local");
            await pulsar(page, "Enviar enlace");
            await esperarTexto(page, "Si hay una cuenta registrada con");
            const recover = registro.filter(r => r.ruta === "/auth/v1/recover").at(-1);
            assert.strictEqual(recover.datos.email, "ana@prueba.local");
            assert.strictEqual(recover.redirectTo, `${PANEL}/restablecer-contrasena`);
        });

        await prueba("solicitud: límite de envíos -> mensaje claro", async () => {
            const page = await pagina();
            await page.goto(`${PANEL}/recuperar-contrasena`);
            await esperarTexto(page, "Enviar enlace");
            await escribir(page, "Correo", "limite@prueba.local");
            await pulsar(page, "Enviar enlace");
            await esperarTexto(page, "demasiadas solicitudes");
        });

        await prueba("sin enlace: no hay formulario, se ofrece solicitar otro", async () => {
            const page = await pagina();
            await page.goto(`${PANEL}/restablecer-contrasena`);
            await esperarTexto(page, "abre el enlace que te enviamos");
            assert.strictEqual(await page.$('[aria-label="Nueva contraseña"]'), null);
            await esperarTexto(page, "Solicitar un enlace nuevo");
        });

        await prueba("enlace caducado (otp_expired): mensaje, solicitar otro y URL limpia", async () => {
            const page = await pagina();
            await page.goto(`${PANEL}/restablecer-contrasena#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`);
            await esperarTexto(page, "caducó o ya se utilizó");
            assert.strictEqual(await page.$('[aria-label="Nueva contraseña"]'), null);
            assert.ok(!(await page.evaluate(() => location.href)).includes("otp_expired"));
        });

        await prueba("SEGURIDAD: con una sesión iniciada, un enlace caducado NO habilita el cambio", async () => {
            const page = await pagina({ sesion: sesionGuardada(TOKEN_ANTERIOR) });
            await page.goto(`${PANEL}/restablecer-contrasena#error=access_denied&error_code=otp_expired&error_description=expired`);
            await esperarTexto(page, "caducó o ya se utilizó");
            assert.strictEqual(await page.$('[aria-label="Nueva contraseña"]'), null);
        });

        await prueba("SEGURIDAD: un token de recuperación inválido no vale aunque haya otra sesión", async () => {
            const page = await pagina({ sesion: sesionGuardada(TOKEN_ANTERIOR) });
            await page.goto(`${PANEL}/restablecer-contrasena${hashRecuperacion("tok-falso")}`);
            await esperarTexto(page, "Enlace no válido");
            assert.strictEqual(await page.$('[aria-label="Nueva contraseña"]'), null);
        });

        await prueba("enlace válido: formulario, no coincidentes, misma contraseña, error de red y cambio correcto -> login", async () => {
            const page = await pagina();
            await page.goto(`${PANEL}/restablecer-contrasena${hashRecuperacion(TOKEN_RECUPERACION)}`);
            await esperarTexto(page, "Crea una contraseña nueva para");
            await esperarTexto(page, USUARIO.email);
            assert.ok(!(await page.evaluate(() => location.href)).includes(TOKEN_RECUPERACION), "el token no queda en la URL");

            await escribir(page, "Nueva contraseña", CLAVE_NUEVA);
            await escribir(page, "Confirmar contraseña", CLAVE_NUEVA + "x");
            await pulsar(page, "Guardar contraseña");
            await esperarTexto(page, "Las contraseñas no coinciden.");
            assert.strictEqual(registro.filter(r => r.metodo === "PUT").length, 0);

            await escribir(page, "Nueva contraseña", CLAVE_IGUAL);
            await escribir(page, "Confirmar contraseña", CLAVE_IGUAL);
            await pulsar(page, "Guardar contraseña");
            await esperarTexto(page, "debe ser distinta de la anterior");

            modoActualizacion = "sin_red";
            await escribir(page, "Nueva contraseña", CLAVE_NUEVA);
            await escribir(page, "Confirmar contraseña", CLAVE_NUEVA);
            await pulsar(page, "Guardar contraseña");
            await esperarTexto(page, "problema de conexión");
            modoActualizacion = "ok";

            await pulsar(page, "Guardar contraseña");
            await page.waitForFunction(() => location.pathname === "/login", { timeout: 60000 });
            await esperarTexto(page, "Tu contraseña se actualizó");
            const put = registro.filter(r => r.metodo === "PUT" && r.datos.password === CLAVE_NUEVA).at(-1);
            assert.strictEqual(put.token, TOKEN_RECUPERACION, "se cambia con la sesión del enlace");
            assert.ok(registro.some(r => r.ruta === "/auth/v1/logout"), "la sesión de recuperación se cierra");
            assert.strictEqual(await page.evaluate(() => localStorage.getItem("sb-127-auth-token")), null);
            const log = page.consola.join("\n");
            for (const s of [CLAVE_NUEVA, CLAVE_IGUAL, TOKEN_RECUPERACION]) assert.ok(!log.includes(s), `la consola no muestra ${s}`);
            assert.deepStrictEqual(page.erroresJs, []);
        });

        await prueba("login tras el cambio: la contraseña anterior ya no entra y la nueva sí", async () => {
            assert.strictEqual(claveActual, CLAVE_NUEVA, "el cambio quedó guardado en Auth");
            const page = await pagina();
            await page.goto(`${PANEL}/login`);
            await esperarTexto(page, "Iniciar sesión");
            await escribir(page, "Correo", USUARIO.email);
            await escribir(page, "Contraseña", CLAVE_ANTERIOR);
            await pulsar(page, "Iniciar sesión");
            await esperarTexto(page, "Correo o contraseña incorrectos.");
            await escribir(page, "Contraseña", CLAVE_NUEVA);
            await pulsar(page, "Iniciar sesión");
            await page.waitForFunction(() => location.pathname === "/sesiones", { timeout: 60000 });
            assert.ok(!page.consola.join("\n").includes(CLAVE_NUEVA));
        });

        await prueba("otro dispositivo: se pide en un navegador y el enlace se abre en otro sin estado previo", async () => {
            claveActual = CLAVE_ANTERIOR;
            const pide = await pagina();
            await pide.goto(`${PANEL}/recuperar-contrasena`);
            await esperarTexto(pide, "Enviar enlace");
            await escribir(pide, "Correo", USUARIO.email);
            await pulsar(pide, "Enviar enlace");
            await esperarTexto(pide, "Si hay una cuenta registrada con");

            const abre = await pagina();   // contexto nuevo: sin localStorage ni code_verifier
            await abre.goto(`${PANEL}/restablecer-contrasena${hashRecuperacion(TOKEN_RECUPERACION)}`);
            await esperarTexto(abre, "Crea una contraseña nueva para");
            await escribir(abre, "Nueva contraseña", CLAVE_NUEVA);
            await escribir(abre, "Confirmar contraseña", CLAVE_NUEVA);
            await pulsar(abre, "Guardar contraseña");
            await abre.waitForFunction(() => location.pathname === "/login", { timeout: 60000 });
            assert.strictEqual(claveActual, CLAVE_NUEVA);
        });

        for (const ruta of ["/", "/login"]) {
            await prueba(`enlace que cae en «${ruta}» (fallback al Site URL): pasa a /restablecer-contrasena sin entrar al panel`, async () => {
                const page = await pagina();
                const visitadas = [];
                page.on("framenavigated", f => { if (f === page.mainFrame()) visitadas.push(new URL(f.url()).pathname); });
                await page.goto(`${PANEL}${ruta}${hashRecuperacion(TOKEN_RECUPERACION)}`);
                await page.waitForFunction(() => location.pathname === "/restablecer-contrasena", { timeout: 60000 });
                await esperarTexto(page, "Crea una contraseña nueva para");
                assert.ok(!visitadas.includes("/sesiones"), `no pasa por el panel: ${visitadas.join(" -> ")}`);
                assert.ok(!(await page.evaluate(() => location.href)).includes(TOKEN_RECUPERACION));
            });
        }

        await prueba("plantilla con token_hash: válido abre el formulario; usado o caducado no", async () => {
            const buena = await pagina();
            await buena.goto(`${PANEL}/restablecer-contrasena?token_hash=hash-bueno&type=recovery`);
            await esperarTexto(buena, "Crea una contraseña nueva para");
            assert.strictEqual(registro.filter(r => r.ruta === "/auth/v1/verify" && r.datos.token_hash === "hash-bueno").length, 1, "verifyOtp una sola vez");
            assert.ok(!(await buena.evaluate(() => location.href)).includes("hash-bueno"));
            const usada = await pagina();
            await usada.goto(`${PANEL}/restablecer-contrasena?token_hash=hash-usado&type=recovery`);
            await esperarTexto(usada, "caducó o ya se utilizó");
        });

        await prueba("móvil (375 px): sin desbordamiento horizontal en las tres pantallas", async () => {
            const page = await pagina();
            await page.setViewport({ width: 375, height: 740 });
            for (const ruta of ["/login", "/recuperar-contrasena", "/restablecer-contrasena"]) {
                await page.goto(`${PANEL}${ruta}`);
                await page.waitForSelector(".login-card");
                const ancho = await page.evaluate(() => document.documentElement.scrollWidth);
                assert.ok(ancho <= 375, `${ruta}: ${ancho}px`);
            }
        });

    } catch (e) {
        fallos++;
        console.log("❌ entorno:", e.message);
    } finally {
        await cerrar();
    }

    console.log(`TOTAL: ${total}  ✅ PASA: ${total - fallos}  ❌ FALLA: ${fallos}`);
    process.exit(fallos ? 1 : 0);

})();
