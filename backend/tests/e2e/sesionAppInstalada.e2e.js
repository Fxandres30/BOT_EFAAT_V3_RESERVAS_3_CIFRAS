// ==========================================================================
// E2E AISLADA: persistencia de sesión y entrada de la aplicación instalada.
//   - Supabase FALSO local (auth/v1/user, auth/v1/token, rest → []).
//   - panel real con `next dev` apuntando a él. Sin backend del bot.
// Ningún dato sale de esta máquina: no toca Supabase real ni WhatsApp.
// Uso: node backend/tests/e2e/sesionAppInstalada.e2e.js
// ==========================================================================

const assert = require("assert");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");

const FRONTEND = process.env.E2E_FRONTEND || path.resolve(__dirname, "../../../frontend");
const PUERTO_SUPABASE = 54398;
const PUERTO_PANEL = 3101;
const PANEL = `http://127.0.0.1:${PUERTO_PANEL}`;
const CLAVE = "sb-127-auth-token";

// token -> usuario. Tokens revocados: /user responde session_not_found.
const usuarios = new Map([
    ["tok-a", { id: "11111111-1111-1111-1111-111111111111", email: "cliente.a@e2e.test" }],
    ["tok-b", { id: "22222222-2222-2222-2222-222222222222", email: "cliente.b@e2e.test" }]
]);
const revocados = new Set();
// refresh_token -> token nuevo que entrega la renovación.
const renovaciones = new Map();
const peticiones = [];

const usuarioAuth = ({ id, email }) => ({ id, aud: "authenticated", role: "authenticated", email, app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" });
const sesionDe = (token, { caducada = false } = {}) => {
    const ahora = Math.floor(Date.now() / 1000);
    const exp = caducada ? ahora - 3600 : ahora + 3600 * 24;
    return { access_token: token, refresh_token: `r-${token}`, token_type: "bearer", expires_in: 3600, expires_at: exp, user: usuarioAuth(usuarios.get(token)) };
};

function arrancarSupabaseFalso() {
    const s = http.createServer((req, res) => {
        const ruta = req.url.split("?")[0];
        const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
        peticiones.push({ m: req.method, ruta, url: req.url, token });
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Headers", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,POST,PATCH,PUT,DELETE,OPTIONS");
        res.setHeader("Content-Type", "application/json");
        if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
        if (ruta === "/auth/v1/user") {
            if (revocados.has(token)) { res.writeHead(403); return res.end(JSON.stringify({ code: 403, error_code: "session_not_found", msg: "Session from session_id claim in JWT does not exist" })); }
            const u = usuarios.get(token);
            if (!u) { res.writeHead(401); return res.end(JSON.stringify({ code: 401, error_code: "bad_jwt", msg: "invalid JWT" })); }
            return res.end(JSON.stringify(usuarioAuth(u)));
        }
        if (ruta === "/auth/v1/token") {
            let cuerpo = "";
            req.on("data", c => { cuerpo += c; });
            req.on("end", () => {
                const { refresh_token } = JSON.parse(cuerpo || "{}");
                const nuevo = renovaciones.get(refresh_token);
                if (!nuevo) { res.writeHead(400); return res.end(JSON.stringify({ code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token: Refresh Token Not Found" })); }
                res.end(JSON.stringify(sesionDe(nuevo)));
            });
            return;
        }
        if (ruta === "/auth/v1/logout") { res.writeHead(204); return res.end(); }
        if (ruta.startsWith("/rest/v1/")) return res.end("[]");
        res.end("{}");
    });
    return new Promise(r => s.listen(PUERTO_SUPABASE, "127.0.0.1", () => r(s)));
}

function arrancarPanel() {
    const args = ["next", "dev", "-p", String(PUERTO_PANEL), "-H", "127.0.0.1"];
    const [cmd, argv] = process.platform === "win32" ? ["cmd.exe", ["/c", "npx", ...args]] : ["npx", args];
    const hijo = spawn(cmd, argv, {
        cwd: FRONTEND,
        env: {
            ...process.env,
            NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${PUERTO_SUPABASE}`,
            NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-e2e",
            // Backend del bot inexistente: las rutas /api del panel fallan sin salir de la máquina.
            BOT_API_URL: "http://127.0.0.1:9",
            BOT_API_TOKEN: "e2e",
            NEXT_TELEMETRY_DISABLED: "1"
        }
    });
    let salida = "";
    hijo.stdout.on("data", d => { salida += d; });
    hijo.stderr.on("data", d => { salida += d; });
    const listo = new Promise((res, rej) => {
        const limite = setTimeout(() => rej(new Error("next dev no arrancó:\n" + salida)), 180000);
        const mirar = setInterval(() => {
            if (/Ready|ready in|Local:/i.test(salida)) { clearInterval(mirar); clearTimeout(limite); res(); }
        }, 300);
    });
    return { hijo, listo };
}

const esperar = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {

    const supabase = await arrancarSupabaseFalso();
    const panel = arrancarPanel();
    let browser;
    const resultados = [];

    const cerrar = async () => {
        if (browser) await browser.close().catch(() => {});
        if (process.platform === "win32") spawn("taskkill", ["/pid", String(panel.hijo.pid), "/T", "/F"]);
        else panel.hijo.kill("SIGTERM");
        supabase.close();
    };

    try {
        await panel.listo;
        browser = await require("puppeteer").launch({ headless: true });

        // Contexto limpio. sesion: objeto a guardar en localStorage (UNA vez,
        // no en cada carga: si supabase-js la borra, debe quedar borrada).
        // instalada: emula display-mode standalone (aplicación instalada).
        async function nuevaPagina({ sesion = null, instalada = false } = {}) {
            const ctx = await browser.createBrowserContext();
            const page = await ctx.newPage();
            page.setDefaultTimeout(120000);
            page.erroresJs = [];
            page.on("pageerror", e => page.erroresJs.push(e.message));
            page.rutas = [];
            page.on("framenavigated", f => { if (f === page.mainFrame()) page.rutas.push(new URL(f.url()).pathname); });
            if (instalada) {
                await page.evaluateOnNewDocument(() => {
                    const original = window.matchMedia.bind(window);
                    window.matchMedia = (q) => /display-mode:\s*standalone/.test(q)
                        ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }
                        : original(q);
                });
            }
            if (sesion) {
                await page.goto(`${PANEL}/manifest.webmanifest`);
                await page.evaluate((k, v) => localStorage.setItem(k, v), CLAVE, JSON.stringify(sesion));
            }
            return page;
        }

        // Espera a que la ruta se quede quieta en `destino` (y siga ahí 3 s: sin bucles).
        async function asentarEn(page, destino) {
            await page.waitForFunction((d) => location.pathname === d, { timeout: 90000 }, destino);
            await esperar(3000);
            assert.strictEqual(new URL(page.url()).pathname, destino, `se movió de ${destino} a ${page.url()}`);
        }
        const tokenGuardado = (page) => page.evaluate((k) => { const v = localStorage.getItem(k); return v ? JSON.parse(v).access_token : null; }, CLAVE);
        const visible = (page, sel) => page.$eval(sel, el => !!(el.offsetWidth || el.offsetHeight)).catch(() => false);

        async function caso(nombre, fn) {
            const t0 = Date.now();
            try { await fn(); resultados.push(["OK", nombre, Date.now() - t0]); }
            catch (e) { resultados.push(["FALLO", nombre, Date.now() - t0, e.message]); }
        }

        // Precalentar compilación de las rutas (next dev compila bajo demanda).
        for (const r of ["/app", "/login", "/register", "/sesiones", "/tablas", "/"]) await fetch(PANEL + r).catch(() => {});

        await caso("Manifest: start_url /app, scope /", async () => {
            const m = await (await fetch(`${PANEL}/manifest.webmanifest`)).json();
            assert.strictEqual(m.start_url, "/app");
            assert.strictEqual(m.scope, "/");
            assert.strictEqual(m.display, "standalone");
        });

        await caso("HTML inicial con pantalla de carga (sin pantalla blanca antes de hidratar): /app, /login, /register, /sesiones, /tablas", async () => {
            for (const r of ["/app", "/login", "/register", "/sesiones", "/tablas"]) {
                const html = await (await fetch(PANEL + r)).text();
                assert.ok(/role="status"/.test(html) && /(Cargando|Abriendo EFAAT360)/.test(html), `${r} sin pantalla de carga en el HTML`);
            }
        });

        await caso("/app con sesión válida → /sesiones directo (sin landing ni login)", async () => {
            const page = await nuevaPagina({ sesion: sesionDe("tok-a"), instalada: true });
            await page.goto(`${PANEL}/app`);
            await asentarEn(page, "/sesiones");
            const pasos = page.rutas.slice(page.rutas.indexOf("/app"));
            assert.ok(!pasos.includes("/login") && !pasos.includes("/"), `pasó por: ${pasos.join(" → ")}`);
            assert.ok(await visible(page, ".layout"), "panel no visible");
            await page.browserContext().close();
        });

        await caso("/app sin sesión → /login con formulario", async () => {
            const page = await nuevaPagina({ instalada: true });
            await page.goto(`${PANEL}/app`);
            await asentarEn(page, "/login");
            assert.ok(await visible(page, "form.login-card"), "formulario no visible");
            await page.browserContext().close();
        });

        await caso("Sesión expirada con renovación válida → token renovado y /sesiones", async () => {
            renovaciones.set("r-tok-a", "tok-a");
            const caducada = { ...sesionDe("tok-a", { caducada: true }), access_token: "tok-viejo" };
            const page = await nuevaPagina({ sesion: caducada, instalada: true });
            const antes = peticiones.length;
            await page.goto(`${PANEL}/app`);
            await asentarEn(page, "/sesiones");
            assert.ok(peticiones.slice(antes).some(p => p.ruta === "/auth/v1/token"), "no se pidió renovación");
            assert.strictEqual(await tokenGuardado(page), "tok-a");
            renovaciones.delete("r-tok-a");
            await page.browserContext().close();
        });

        await caso("Sesión expirada sin renovación posible → /login y sesión local borrada", async () => {
            const page = await nuevaPagina({ sesion: sesionDe("tok-a", { caducada: true }), instalada: true });
            await page.goto(`${PANEL}/app`);
            await asentarEn(page, "/login");
            assert.ok(await visible(page, "form.login-card"), "formulario no visible");
            assert.strictEqual(await tokenGuardado(page), null);
            await page.browserContext().close();
        });

        await caso("Sesión revocada en el servidor → /login, sesión local borrada, sin bucle", async () => {
            revocados.add("tok-a");
            const page = await nuevaPagina({ sesion: sesionDe("tok-a"), instalada: true });
            await page.goto(`${PANEL}/app`);
            await asentarEn(page, "/login");
            await esperar(3000);
            assert.strictEqual(new URL(page.url()).pathname, "/login");
            assert.strictEqual(await tokenGuardado(page), null);
            const veces = page.rutas.filter(r => r === "/login").length;
            assert.ok(veces <= 2, `/login visitado ${veces} veces`);
            revocados.delete("tok-a");
            await page.browserContext().close();
        });

        await caso("/login con sesión activa → /sesiones", async () => {
            const page = await nuevaPagina({ sesion: sesionDe("tok-a") });
            await page.goto(`${PANEL}/login`);
            await asentarEn(page, "/sesiones");
            await page.browserContext().close();
        });

        await caso("/register con sesión activa → /sesiones", async () => {
            const page = await nuevaPagina({ sesion: sesionDe("tok-a") });
            await page.goto(`${PANEL}/register`);
            await asentarEn(page, "/sesiones");
            await page.browserContext().close();
        });

        await caso("Landing en navegador normal CON sesión → se queda en / (pública)", async () => {
            const page = await nuevaPagina({ sesion: sesionDe("tok-a") });
            await page.goto(`${PANEL}/`);
            await esperar(4000);
            assert.strictEqual(new URL(page.url()).pathname, "/");
            assert.ok((await page.$$eval('a[href="/login"]', a => a.length)) > 0, "landing no renderizada");
            await page.browserContext().close();
        });

        await caso("Landing en navegador normal SIN sesión → se queda en /", async () => {
            const page = await nuevaPagina();
            await page.goto(`${PANEL}/`);
            await esperar(4000);
            assert.strictEqual(new URL(page.url()).pathname, "/");
            await page.browserContext().close();
        });

        await caso("Landing dentro de la app instalada CON sesión (instalación antigua start_url /) → /sesiones", async () => {
            const page = await nuevaPagina({ sesion: sesionDe("tok-a"), instalada: true });
            await page.goto(`${PANEL}/`);
            await asentarEn(page, "/sesiones");
            await page.browserContext().close();
        });

        await caso("Landing dentro de la app instalada SIN sesión → se queda en /", async () => {
            const page = await nuevaPagina({ instalada: true });
            await page.goto(`${PANEL}/`);
            await esperar(4000);
            assert.strictEqual(new URL(page.url()).pathname, "/");
            await page.browserContext().close();
        });

        await caso("Recarga y navegación del panel conservan la sesión", async () => {
            const page = await nuevaPagina({ sesion: sesionDe("tok-a"), instalada: true });
            await page.goto(`${PANEL}/app`);
            await asentarEn(page, "/sesiones");
            await page.reload();
            await asentarEn(page, "/sesiones");
            await page.goto(`${PANEL}/tablas`);
            await asentarEn(page, "/tablas");
            await page.goto(`${PANEL}/mi-cuenta`);
            await asentarEn(page, "/mi-cuenta");
            assert.strictEqual(await tokenGuardado(page), "tok-a");
            await page.browserContext().close();
        });

        await caso("Cierre y reapertura (contexto nuevo con el mismo almacenamiento) → directo a /sesiones", async () => {
            // Simula cerrar la app: se cierra la página y se abre otra en el mismo contexto.
            const page = await nuevaPagina({ sesion: sesionDe("tok-a"), instalada: true });
            await page.goto(`${PANEL}/app`);
            await asentarEn(page, "/sesiones");
            const ctx = page.browserContext();
            await page.close();
            const otra = await ctx.newPage();
            await otra.goto(`${PANEL}/app`);
            await otra.waitForFunction(() => location.pathname === "/sesiones", { timeout: 90000 });
            await ctx.close();
        });

        await caso("Dos usuarios: cada uno entra con su propia cuenta", async () => {
            const a = await nuevaPagina({ sesion: sesionDe("tok-a"), instalada: true });
            const b = await nuevaPagina({ sesion: sesionDe("tok-b"), instalada: true });
            const antes = peticiones.length;
            await Promise.all([a.goto(`${PANEL}/app`), b.goto(`${PANEL}/app`)]);
            await Promise.all([asentarEn(a, "/sesiones"), asentarEn(b, "/sesiones")]);
            assert.strictEqual(await tokenGuardado(a), "tok-a");
            assert.strictEqual(await tokenGuardado(b), "tok-b");
            const usuarioDe = (p) => p.evaluate(async (k) => {
                const s = JSON.parse(localStorage.getItem(k));
                return s.user.email;
            }, CLAVE);
            assert.strictEqual(await usuarioDe(a), "cliente.a@e2e.test");
            assert.strictEqual(await usuarioDe(b), "cliente.b@e2e.test");
            const nuevas = peticiones.slice(antes).filter(p => p.token);
            assert.ok(nuevas.some(p => p.token === "tok-a") && nuevas.some(p => p.token === "tok-b"), "faltan peticiones con el token de cada usuario");
            await a.browserContext().close();
            await b.browserContext().close();
        });

    } finally {
        await cerrar();
    }

    console.log("\nResultados:");
    for (const [estado, nombre, ms, error] of resultados) console.log(`  ${estado.padEnd(5)} ${nombre} (${ms} ms)${error ? `\n        → ${error}` : ""}`);
    const fallos = resultados.filter(r => r[0] !== "OK").length;
    console.log(`\n${resultados.length - fallos}/${resultados.length} correctos`);
    const externas = peticiones.length; // todas fueron al Supabase falso local
    console.log(`Peticiones atendidas por el Supabase falso local: ${externas}`);
    process.exit(fallos ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
