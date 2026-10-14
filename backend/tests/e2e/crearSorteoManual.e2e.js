// ==========================================================================
// PRUEBA DE EXTREMO A EXTREMO — crear un sorteo de 2 cifras A MANO desde
// /eventos, con un navegador real (Chrome vía puppeteer), el panel Next real
// (next dev) y la API real del backend (routes/sorteos.js + sorteos/*).
//
// ENTORNO AISLADO: no toca Supabase ni WhatsApp.
//   - Backend: rutas /sorteos reales sobre el Supabase FALSO en memoria de
//     tests/sorteos/fakeSupabaseSorteos.js. No arranca el bot, ni Baileys,
//     ni el publicador: nada se envía.
//   - Panel: NEXT_PUBLIC_SUPABASE_URL apunta a un servidor local falso
//     (responde [] a /rest/v1 y un usuario de prueba a /auth/v1/user). La
//     sesión se inyecta en localStorage.
//
//     node backend/tests/e2e/crearSorteoManual.e2e.js
//
// No se incluye en la regresión (`*.test.js`): necesita compilar el panel.
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
const TOKEN_USUARIO = "e2e-token-usuario";
const A = "aaaaaaaa-0000-4000-8000-00000000000a";

process.env.SESSIONS_API_TOKEN = TOKEN_SERVICIO;

// ---------------------------------------------------------- base falsa ---
const { crearFake } = require("../sorteos/fakeSupabaseSorteos");
const fake = crearFake();

require.cache[r("lib/supabase.js")] = {
    id: r("lib/supabase.js"), filename: r("lib/supabase.js"), loaded: true,
    exports: { from: (t) => fake.client.from(t), auth: { getUser: (t) => fake.client.auth.getUser(t) } }
};

const t = fake.tablas;
t.grupos_autorizados = [
    { usuario_id: A, grupo_id: "g1@g.us", activo: true },
    { usuario_id: A, grupo_id: "g2@g.us", activo: true }
];
t.grupos = [{ jid: "g1@g.us", nombre: "Grupo Prueba Uno" }, { jid: "g2@g.us", nombre: "Grupo Prueba Dos" }];
t.cuentas_pago = [{ id: "cuenta-e2e", usuario_id: A, nombre: "Nequi Prueba", tipo: "nequi", numero: "3000000001", titular: "Prueba", activa: true }];
t.eventos_bot = [];   // ningún anuncio detectado: el flujo no depende del detector
for (const tabla of ["reservas_dos_cifras", "5k_15k_reservas_2_cifras"]) {
    t[tabla] = Array.from({ length: 100 }, (_, i) => ({ numero: String(i).padStart(2, "0"), estado: "libre", usuario_id: A }));
}
fake.tokens[TOKEN_USUARIO] = A;

// ---------------------------------------------------- servidores falsos ---
const express = require("express");

function arrancarBackend() {
    const app = express();
    app.use(express.json());
    app.use("/sorteos", require(r("routes/sorteos.js")));
    return new Promise(res => { const s = app.listen(PUERTO_BACKEND, "127.0.0.1", () => res(s)); });
}

const peticionesSupabase = [];

function arrancarSupabaseFalso() {
    const s = http.createServer((req, res) => {
        peticionesSupabase.push(`${req.method} ${req.url.split("?")[0]}`);
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Headers", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
        res.setHeader("Content-Type", "application/json");
        if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
        if (req.url.startsWith("/auth/v1/user")) return res.end(JSON.stringify(usuarioPrueba()));
        if (req.url.startsWith("/rest/v1/")) return res.end("[]");
        res.end("{}");
    });
    return new Promise(res => s.listen(PUERTO_SUPABASE, "127.0.0.1", () => res(s)));
}

function usuarioPrueba() {
    return { id: A, aud: "authenticated", role: "authenticated", email: "e2e@prueba.local", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
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
        salida: () => salida,
        listo: new Promise((res, rej) => {
            const limite = setTimeout(() => rej(new Error("next dev no arrancó:\n" + salida)), 180000);
            const mirar = setInterval(() => {
                if (/Ready|ready in|Local:/i.test(salida)) { clearInterval(mirar); clearTimeout(limite); res(); }
            }, 300);
        })
    };
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

// Mañana a las 08:00 (hora de Colombia), formato datetime-local.
function mananaColombia() {
    const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const d = new Date(`${hoy}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return `${d.toISOString().slice(0, 10)}T08:00`;
}

// ------------------------------------------------------------- escenario ---
const pasos = [];
const paso = (n) => { pasos.push(n); console.log(`✅ ${n}`); };

async function main() {

    const backend = await arrancarBackend();
    const supabaseFalso = await arrancarSupabaseFalso();
    const panel = arrancarPanel();
    let browser;

    try {

        await panel.listo;

        const puppeteer = require("puppeteer");
        browser = await puppeteer.launch({ headless: true });
        const page = await browser.newPage();
        page.setDefaultTimeout(120000);
        page.on("dialog", d => d.accept());   // window.confirm de «Cancelar»

        const erroresConsola = [];
        page.on("pageerror", e => erroresConsola.push(e.message));

        await page.evaluateOnNewDocument((sesion) => {
            localStorage.setItem("sb-127-auth-token", JSON.stringify(sesion));
        }, {
            access_token: TOKEN_USUARIO, refresh_token: "r-e2e", token_type: "bearer",
            expires_in: 3600 * 24, expires_at: Math.floor(Date.now() / 1000) + 3600 * 24, user: usuarioPrueba()
        });

        // 1. /eventos -> botón «Crear sorteo» abre el modal correcto.
        await page.goto(`${PANEL}/eventos`, { waitUntil: "domcontentloaded" });
        await pulsar(page, "Crear sorteo");
        await esperarTexto(page, "Configurar sorteo");
        const textoModal = await textoPagina(page);
        assert.ok(!/se crean automáticamente/i.test(textoModal), "el mensaje antiguo NO debe aparecer");
        assert.ok(textoModal.includes("2 CIFRAS — PAGO"));
        paso("/eventos: «Crear sorteo» abre el modal de modalidad, sin el mensaje antiguo");

        // 2. 3 cifras deshabilitadas de verdad.
        await marcar(page, "3 CIFRAS — PAGO");
        await esperarTexto(page, "Todavía no disponible");
        assert.strictEqual(await botonHabilitado(page, "Configurar sorteo"), false);
        await marcar(page, "3 CIFRAS — GRATIS");
        assert.strictEqual(await botonHabilitado(page, "Configurar sorteo"), false);
        await marcar(page, "2 CIFRAS — PAGO");
        assert.strictEqual(await botonHabilitado(page, "Configurar sorteo"), true);
        paso("3 cifras de pago y gratis: «Configurar sorteo» deshabilitado; 2 cifras habilitado");

        // 3. Formulario manual real.
        await pulsar(page, "Configurar sorteo");
        await esperarTexto(page, "Nuevo sorteo");
        await esperarTexto(page, "Grupo Prueba Uno");   // catálogos cargados del backend
        await esperarTexto(page, "Nequi Prueba");
        const opciones = await page.evaluate(() => [...document.querySelectorAll("option")].map(o => ({ v: o.value, d: o.disabled })));
        assert.ok(opciones.some(o => o.v === "tres_cifras_pago" && o.d) && opciones.some(o => o.v === "tres_cifras_gratis" && o.d), "3 cifras deshabilitadas en el formulario");
        paso("el botón abre el formulario de creación manual (grupos y cuentas desde el backend)");

        const publicarEn = mananaColombia();
        await rellenar(page, "Lotería o nombre del sorteo", "Lotería E2E Manual");
        await rellenar(page, "Hora del sorteo", "22:30");
        await rellenar(page, "Cierre de reservas", "22:20");
        await rellenar(page, "Valor por número", "5000");
        await rellenarAria(page, "Premio", "Premio mayor");
        await rellenarAria(page, "Valor del premio", "300000");
        await marcar(page, "Grupo Prueba Uno");
        await marcar(page, "Grupo Prueba Dos");
        await marcar(page, "Nequi Prueba");
        await rellenar(page, "Fecha y hora de publicación", publicarEn);
        await rellenar(page, "Mensaje de publicación", "🎯 {{nombre}} a las {{hora}} — valor {{valor}}\n{{premios}}\n{{cuentas}}");
        await rellenar(page, "Aviso al cerrar", "🔒 {{nombre}} cerrado");
        await pulsar(page, "Agregar recordatorio");
        await rellenarAria(page, "Texto del recordatorio", "⏰ Falta 1 hora para {{nombre}}");
        await rellenarAria(page, "Minutos antes del cierre", "60");

        // 4. Guardar -> borrador REAL en el backend + vista previa.
        await pulsar(page, "Guardar y ver vista previa");
        await esperarTexto(page, "Anuncio que se publicará");
        const filas = t.sorteos_programados || [];
        assert.strictEqual(filas.length, 1, "un borrador en la base");
        const sorteo = filas[0];
        assert.strictEqual(sorteo.estado, "borrador");
        assert.strictEqual(sorteo.usuario_id, A);
        assert.strictEqual(sorteo.config.nombre, "Lotería E2E Manual");
        assert.strictEqual(Number(sorteo.config.valor), 5000);
        assert.deepStrictEqual([...sorteo.config.grupos].sort(), ["g1@g.us", "g2@g.us"]);
        assert.strictEqual(sorteo.cuentas_snapshot[0].nombre, "Nequi Prueba");
        paso(`borrador guardado en el backend (id ${sorteo.id.slice(0, 8)}, estado borrador, 2 grupos, cuenta copiada)`);

        const vista = await textoPagina(page);
        for (const esperado of ["Lotería E2E Manual", "10:30 PM", "$5.000", "Premio mayor", "Nequi Prueba", "Grupo Prueba Uno", "Grupo Prueba Dos", "Falta 1 hora para Lotería E2E Manual", "Lotería E2E Manual cerrado", "Tabla de números: 100/100"]) {
            assert.ok(vista.includes(esperado), `la vista previa debe mostrar «${esperado}»:
${vista}`);
        }
        assert.ok(!/\{\{/.test(vista.split("Anuncio que se publicará")[1] || ""), "sin variables sin resolver");
        assert.strictEqual(await botonHabilitado(page, "Confirmar y programar"), false, "no se confirma sin marcar la revisión");
        paso("vista previa con los datos guardados (anuncio, premios, cuenta, grupos, recordatorio, aviso)");

        // 5. Recargar -> el borrador persiste y aparece en «Sorteos programados».
        await pulsar(page, "Cerrar");
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForFunction(() => document.body.textContent.includes("Los sorteos creados desde el panel"), { timeout: 60000 });
        await page.evaluate(() => [...document.querySelectorAll("a")].find(a => a.getAttribute("href") === "/sorteos" && a.closest("details")).click());
        await page.waitForFunction(() => location.pathname === "/sorteos");
        await page.reload({ waitUntil: "domcontentloaded" });
        await esperarTexto(page, "Lotería E2E Manual");
        await esperarTexto(page, "Borrador (sin confirmar)");
        paso("tras recargar /eventos, su enlace lleva a «Sorteos programados», donde el borrador persiste");

        // 6. Editar (borrador): versión 2, sin duplicar grupos.
        await pulsar(page, "Editar");
        await esperarTexto(page, "Editar sorteo programado");
        await rellenar(page, "Valor por número", "5000");
        await rellenar(page, "Lotería o nombre del sorteo", "Lotería E2E Manual (editada)");
        await pulsar(page, "Guardar y ver vista previa");
        await esperarTexto(page, "Anuncio que se publicará");
        await esperarTexto(page, "Lotería E2E Manual (editada)");
        assert.strictEqual(t.sorteos_programados.length, 1, "editar no crea otro sorteo");
        assert.strictEqual(t.sorteos_programados[0].version, 2);
        paso("editar el borrador: misma fila, versión 2, vista previa actualizada");

        // 7. Confirmación expresa -> programado. Nada se envía.
        await marcar(page, "Revisé el anuncio");
        await pulsar(page, "Confirmar y programar");
        await page.waitForFunction(() => !document.body.innerText.includes("Anuncio que se publicará"));
        await esperarTexto(page, "Programado");
        const prog = t.sorteos_programados[0];
        assert.strictEqual(prog.estado, "programado");
        assert.strictEqual(prog.confirmado_version, 2);
        const gruposPub = (t.sorteos_programados_grupos || []).filter(g => g.sorteo_id === prog.id);
        assert.strictEqual(gruposPub.length, 2, "un registro por grupo");
        assert.ok(gruposPub.every(g => g.estado === "pendiente" && !g.publicado_en));
        assert.strictEqual((t.automation_actions || []).length, 0, "ningún envío");
        assert.strictEqual(t.eventos_bot.length, 0, "no se creó ningún evento ni se publicó nada");
        paso("confirmación expresa: estado programado (versión 2), 2 grupos pendientes, 0 envíos");

        // 8. Recargar y cancelar: sin duplicados ni publicaciones.
        await page.reload({ waitUntil: "domcontentloaded" });
        await esperarTexto(page, "Programado");
        await pulsar(page, "Cancelar");
        await esperarTexto(page, "Cancelado");
        assert.strictEqual(t.sorteos_programados.length, 1);
        assert.strictEqual(t.sorteos_programados[0].estado, "cancelado");
        assert.strictEqual((t.sorteos_programados_grupos || []).filter(g => g.sorteo_id === prog.id).length, 2, "sin grupos duplicados");
        assert.strictEqual((t.automation_actions || []).length, 0);
        paso("cancelar: estado cancelado, sin filas duplicadas ni publicaciones");

        // 9. Aislamiento: el panel no habló con ningún Supabase real.
        assert.ok(peticionesSupabase.every(p => !/sorteos_programados|cuentas_pago/.test(p)), "el panel no escribe sorteos directo en la base");
        assert.deepStrictEqual(erroresConsola, [], "sin errores de JavaScript en la página");
        paso("aislado: sin Supabase real; el panel solo usa la API /sorteos; sin errores de JS");

    } finally {
        if (browser) await browser.close();
        if (process.platform === "win32") spawn("taskkill", ["/pid", String(panel.hijo.pid), "/T", "/F"]);
        else panel.hijo.kill("SIGTERM");
        backend.close();
        supabaseFalso.close();
    }

}

main().then(() => {
    console.log(`\n============================\nTOTAL: ${pasos.length}  ✅ PASA: ${pasos.length}  ❌ FALLA: 0\n============================`);
    setTimeout(() => process.exit(0), 1500);
}).catch((e) => {
    console.log(`❌ ${e.stack || e}`);
    console.log(`\n============================\nPASOS OK: ${pasos.length}  ❌ FALLA en el siguiente\n============================`);
    setTimeout(() => process.exit(1), 1500);
});
