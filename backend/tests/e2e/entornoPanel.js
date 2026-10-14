// ==========================================================================
// Entorno AISLADO para pruebas de navegador del panel (puppeteer):
//   - backend: rutas reales /sorteos sobre el Supabase FALSO en memoria
//     (tests/sorteos/fakeSupabaseSorteos.js). Sin bot, Baileys ni publicador.
//   - Supabase falso para el navegador (auth/v1/user según el token, [] en
//     /rest/v1).
//   - panel real con `next dev`, apuntando a los dos anteriores.
// Ningún dato sale de esta máquina: no toca Supabase ni WhatsApp.
// ==========================================================================

const assert = require("assert");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");

const RAIZ = path.resolve(__dirname, "../..");
const FRONTEND = path.resolve(RAIZ, "../frontend");
const r = (p) => path.join(RAIZ, p);

const PUERTO_BACKEND = 4100;
const PUERTO_SUPABASE = 54399;
const PUERTO_PANEL = 3100;
const PANEL = `http://127.0.0.1:${PUERTO_PANEL}`;
const TOKEN_SERVICIO = "e2e-token-servicio";

process.env.SESSIONS_API_TOKEN = TOKEN_SERVICIO;

const { crearFake } = require("../sorteos/fakeSupabaseSorteos");
const fake = crearFake();

require.cache[r("lib/supabase.js")] = {
    id: r("lib/supabase.js"), filename: r("lib/supabase.js"), loaded: true,
    exports: { from: (t) => fake.client.from(t), auth: { getUser: (t) => fake.client.auth.getUser(t) } }
};

// token -> { id, email }
const usuarios = new Map();

function registrarUsuario(token, id, email) {
    usuarios.set(token, { id, email });
    fake.tokens[token] = id;
}

const usuarioAuth = ({ id, email }) => ({ id, aud: "authenticated", role: "authenticated", email, app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" });

const peticionesSupabase = [];

// Tablas que el navegador lee/escribe DE VERDAD (en fake.tablas, la misma
// base en memoria que usa el backend). El resto responde [] como siempre.
const tablasRest = new Set();
const servirTablas = (nombres) => nombres.forEach(n => tablasRest.add(n));

// Subconjunto mínimo de PostgREST: filtros eq./is.null, conteo (HEAD +
// Prefer count), objeto único (Accept vnd.pgrst.object), insert/upsert
// (on_conflict) y update.
function restEnMemoria(req, res, cuerpo) {
    const url = new URL(req.url, "http://x");
    const tabla = decodeURIComponent(url.pathname.replace("/rest/v1/", ""));
    const filas = fake.tablas[tabla] || (fake.tablas[tabla] = []);
    const reservados = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);
    const filtros = [...url.searchParams].filter(([k]) => !reservados.has(k)).map(([col, expr]) => {
        const [op, ...resto] = expr.split(".");
        const val = resto.join(".");
        if (op === "eq") return f => String(f[col]) === val;
        if (op === "is" && val === "null") return f => f[col] == null;
        return () => true;
    });
    const coinciden = () => filas.filter(f => filtros.every(fn => fn(f)));
    const objeto = /vnd\.pgrst\.object/.test(req.headers.accept || "");
    const prefer = req.headers.prefer || "";
    const responder = (lista) => {
        if (/count=/.test(prefer)) res.setHeader("Content-Range", `${lista.length ? `0-${lista.length - 1}` : "*"}/${lista.length}`);
        if (req.method === "HEAD") { res.writeHead(200); return res.end(); }
        if (objeto) {
            if (lista.length !== 1) { res.writeHead(406); return res.end(JSON.stringify({ code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: `${lista.length} rows`, hint: null })); }
            return res.end(JSON.stringify(lista[0]));
        }
        res.end(JSON.stringify(lista));
    };
    if (req.method === "GET" || req.method === "HEAD") return responder(coinciden());
    const datos = cuerpo ? JSON.parse(cuerpo) : {};
    if (req.method === "POST") {
        const conflicto = (url.searchParams.get("on_conflict") || "").split(",").filter(Boolean);
        const resultado = [];
        for (const fila of Array.isArray(datos) ? datos : [datos]) {
            const existente = conflicto.length ? filas.find(f => conflicto.every(c => f[c] === fila[c])) : null;
            if (existente) { Object.assign(existente, fila); resultado.push(existente); continue; }
            const nueva = { id: `rest-${tabla}-${filas.length + 1}`, ...fila };
            filas.push(nueva);
            resultado.push(nueva);
        }
        return responder(resultado);
    }
    if (req.method === "PATCH") {
        const lista = coinciden();
        lista.forEach(f => Object.assign(f, datos));
        return responder(lista);
    }
    if (req.method === "DELETE") {
        const borrar = new Set(coinciden());
        fake.tablas[tabla] = filas.filter(f => !borrar.has(f));
        return responder([...borrar]);
    }
    res.end("[]");
}

function arrancarBackend() {
    const express = require("express");
    const app = express();
    app.use(express.json());
    app.use("/sorteos", require(r("routes/sorteos.js")));
    return new Promise(res => { const s = app.listen(PUERTO_BACKEND, "127.0.0.1", () => res(s)); });
}

function arrancarSupabaseFalso() {
    const s = http.createServer((req, res) => {
        peticionesSupabase.push(`${req.method} ${req.url.split("?")[0]}`);
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Headers", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,POST,PATCH,PUT,DELETE,OPTIONS");
        res.setHeader("Access-Control-Expose-Headers", "Content-Range");
        res.setHeader("Content-Type", "application/json");
        if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
        if (req.url.startsWith("/auth/v1/user")) {
            const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
            const u = usuarios.get(token);
            if (!u) { res.writeHead(401); return res.end("{}"); }
            return res.end(JSON.stringify(usuarioAuth(u)));
        }
        if (req.url.startsWith("/rest/v1/")) {
            const tabla = decodeURIComponent(new URL(req.url, "http://x").pathname.replace("/rest/v1/", ""));
            if (!tablasRest.has(tabla)) return res.end("[]");
            let cuerpo = "";
            req.on("data", c => { cuerpo += c; });
            req.on("end", () => restEnMemoria(req, res, cuerpo));
            return;
        }
        res.end("{}");
    });
    return new Promise(res => s.listen(PUERTO_SUPABASE, "127.0.0.1", () => res(s)));
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
            BOT_API_URL: `http://127.0.0.1:${PUERTO_BACKEND}`,
            BOT_API_TOKEN: TOKEN_SERVICIO,
            NEXT_TELEMETRY_DISABLED: "1"
        }
    });
    let salida = "";
    hijo.stdout.on("data", d => { salida += d; });
    hijo.stderr.on("data", d => { salida += d; });
    return {
        hijo,
        listo: new Promise((res, rej) => {
            const limite = setTimeout(() => rej(new Error("next dev no arrancó:\n" + salida)), 180000);
            const mirar = setInterval(() => {
                if (/Ready|ready in|Local:/i.test(salida)) { clearInterval(mirar); clearTimeout(limite); res(); }
            }, 300);
        })
    };
}

// Arranca todo y devuelve { browser, nuevaPagina(token), cerrar() }.
async function arrancarEntorno() {

    const backend = await arrancarBackend();
    const supabaseFalso = await arrancarSupabaseFalso();
    const panel = arrancarPanel();
    let browser = null;

    const cerrar = async () => {
        if (browser) await browser.close();
        if (process.platform === "win32") spawn("taskkill", ["/pid", String(panel.hijo.pid), "/T", "/F"]);
        else panel.hijo.kill("SIGTERM");
        backend.close();
        supabaseFalso.close();
    };

    try {
        await panel.listo;
        const puppeteer = require("puppeteer");
        browser = await puppeteer.launch({ headless: true });
    } catch (e) {
        await cerrar();
        throw e;
    }

    // Página con la sesión del usuario del token inyectada en localStorage.
    async function nuevaPagina(token) {
        const contexto = await browser.createBrowserContext();
        const page = await contexto.newPage();
        page.setDefaultTimeout(120000);
        page.on("dialog", d => d.accept());
        page.erroresJs = [];
        page.on("pageerror", e => page.erroresJs.push(e.message));
        const u = usuarios.get(token);
        await page.evaluateOnNewDocument((sesion) => {
            localStorage.setItem("sb-127-auth-token", JSON.stringify(sesion));
        }, {
            access_token: token, refresh_token: `r-${token}`, token_type: "bearer",
            expires_in: 3600 * 24, expires_at: Math.floor(Date.now() / 1000) + 3600 * 24, user: usuarioAuth(u)
        });
        return page;
    }

    return { browser, nuevaPagina, cerrar };

}

// ------------------------------------------------------------ navegador ---
async function rellenar(page, etiqueta, valor) {
    const ok = await page.evaluate((etiqueta, valor) => {
        const label = [...document.querySelectorAll("label")].find(l => l.textContent.trim().startsWith(etiqueta) && l.htmlFor);
        const el = label && document.getElementById(label.htmlFor);
        if (!el) return false;
        const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, "value").set.call(el, valor);
        el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
        return true;
    }, etiqueta, valor);
    assert.ok(ok, `campo no encontrado: ${etiqueta}`);
}

async function rellenarAria(page, aria, valor) {
    const ok = await page.evaluate((aria, valor) => {
        const el = document.querySelector(`[aria-label="${aria}"]`);
        if (!el) return false;
        const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, "value").set.call(el, valor);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
    }, aria, valor);
    assert.ok(ok, `campo no encontrado: ${aria}`);
}

const valorDe = (page, etiqueta) => page.evaluate((etiqueta) => {
    const label = [...document.querySelectorAll("label")].find(l => l.textContent.trim().startsWith(etiqueta) && l.htmlFor);
    const el = label && document.getElementById(label.htmlFor);
    return el ? el.value : null;
}, etiqueta);

async function marcar(page, textoEtiqueta) {
    const ok = await page.evaluate((texto) => {
        const label = [...document.querySelectorAll("label")].find(l => l.textContent.trim().startsWith(texto));
        const input = label && label.querySelector("input");
        if (!input) return false;
        input.click();
        return true;
    }, textoEtiqueta);
    assert.ok(ok, `casilla no encontrada: ${textoEtiqueta}`);
}

const marcada = (page, textoEtiqueta) => page.evaluate((texto) => {
    const label = [...document.querySelectorAll("label")].find(l => l.textContent.trim().startsWith(texto));
    const input = label && label.querySelector("input");
    return input ? input.checked : null;
}, textoEtiqueta);

async function pulsar(page, texto) {
    await page.waitForFunction((texto) => [...document.querySelectorAll("button")].some(b => b.textContent.trim() === texto && !b.disabled), { timeout: 60000 }, texto);
    await page.evaluate((texto) => [...document.querySelectorAll("button")].find(b => b.textContent.trim() === texto && !b.disabled).click(), texto);
}

const botonHabilitado = (page, texto) => page.evaluate((texto) => {
    const b = [...document.querySelectorAll("button")].find(x => x.textContent.trim() === texto);
    return b ? !b.disabled : null;
}, texto);

const esperarTexto = (page, texto, timeout = 60000) =>
    page.waitForFunction((texto) => document.body.innerText.includes(texto), { timeout }, texto);

const textoPagina = (page) => page.evaluate(() => document.body.innerText);

const captura = (page, nombre) => process.env.E2E_CAPTURAS
    ? page.screenshot({ path: path.join(process.env.E2E_CAPTURAS, `${nombre}.png`) })
    : null;

// Fecha (Colombia) dentro de `dias` días, "YYYY-MM-DD".
function fechaColombia(dias = 1) {
    const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const d = new Date(`${hoy}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + dias);
    return d.toISOString().slice(0, 10);
}

// Mañana a las 08:00 (hora de Colombia), formato datetime-local.
const mananaColombia = () => `${fechaColombia(1)}T08:00`;

function crearPasos() {
    const pasos = [];
    return {
        pasos,
        paso: (n) => { pasos.push(n); console.log(`✅ ${n}`); },
        terminar: (promesa) => promesa.then(() => {
            console.log(`\n============================\nTOTAL: ${pasos.length}  ✅ PASA: ${pasos.length}  ❌ FALLA: 0\n============================`);
            setTimeout(() => process.exit(0), 1500);
        }).catch((e) => {
            console.log(`❌ ${e.stack || e}`);
            console.log(`\n============================\nPASOS OK: ${pasos.length}  ❌ FALLA en el siguiente\n============================`);
            setTimeout(() => process.exit(1), 1500);
        })
    };
}

module.exports = {
    PANEL,
    fake,
    tablas: fake.tablas,
    peticionesSupabase,
    servirTablas,
    registrarUsuario,
    arrancarEntorno,
    rellenar,
    rellenarAria,
    valorDe,
    marcar,
    marcada,
    pulsar,
    botonHabilitado,
    esperarTexto,
    textoPagina,
    captura,
    fechaColombia,
    mananaColombia,
    crearPasos
};
