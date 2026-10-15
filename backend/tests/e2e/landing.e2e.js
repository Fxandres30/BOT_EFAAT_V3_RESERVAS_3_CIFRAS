// ==========================================================================
// E2E de navegador — landing pública "/" y demostración aislada.
//
// Arranca el panel real con `next dev` apuntando Supabase y el backend a un
// puerto donde NO escucha nadie: aunque algo intentara salir, no llegaría a
// ningún servicio real. Registra TODAS las peticiones del navegador mientras
// se usa la demo y falla si alguna va a Supabase, al backend o a /api/*
// (salvo /api/e, la analítica anónima de visitas que ya existe en todas las
// páginas del panel).
//
//     node backend/tests/e2e/landing.e2e.js [carpeta-capturas]
// ==========================================================================

const assert = require("assert");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const puppeteer = require("puppeteer");

const FRONTEND = path.resolve(__dirname, "../../../frontend");
const PUERTO = 3110;
const PANEL = `http://127.0.0.1:${PUERTO}`;
const MUERTO = "http://127.0.0.1:59999";
const CAPTURAS = process.argv[2] ? path.resolve(process.argv[2]) : null;

function arrancarPanel() {
    const args = ["next", "dev", "-p", String(PUERTO), "-H", "127.0.0.1"];
    const [cmd, argv] = process.platform === "win32" ? ["cmd.exe", ["/c", "npx", ...args]] : ["npx", args];
    const hijo = spawn(cmd, argv, {
        cwd: FRONTEND,
        env: {
            ...process.env,
            NEXT_PUBLIC_SUPABASE_URL: MUERTO,
            NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-e2e",
            BOT_API_URL: MUERTO,
            BOT_API_TOKEN: "e2e",
            NEXT_TELEMETRY_DISABLED: "1"
        }
    });
    let salida = "";
    hijo.stdout.on("data", (d) => { salida += d; });
    hijo.stderr.on("data", (d) => { salida += d; });
    const listo = new Promise((res, rej) => {
        const limite = setTimeout(() => rej(new Error("next dev no arrancó:\n" + salida)), 180000);
        const mirar = setInterval(() => {
            if (/Ready|ready in|Local:/i.test(salida)) { clearInterval(mirar); clearTimeout(limite); res(); }
        }, 300);
    });
    return { hijo, listo };
}

function detener(hijo) {
    if (process.platform === "win32") spawn("taskkill", ["/pid", String(hijo.pid), "/T", "/F"]);
    else hijo.kill("SIGTERM");
}

// Peticiones que NO son recursos propios de Next (JS/CSS/HMR/fuentes).
function esPeticionDeDatos(url) {
    const u = new URL(url);
    if (u.origin !== PANEL) return true;
    return !/^\/(_next\/|__nextjs|favicon\.ico)/.test(u.pathname) && u.pathname !== "/";
}

async function main() {

    const { hijo, listo } = arrancarPanel();
    let browser;
    let ok = 0;
    const paso = (t) => { ok++; console.log("  ✔", t); };

    try {
        await listo;
        browser = await puppeteer.launch({ headless: true });

        // ------------------------------------------------ escritorio ----
        console.log("Escritorio (1440×900)");
        const page = await browser.newPage();
        await page.setViewport({ width: 1440, height: 900 });

        const peticiones = [];
        const erroresConsola = [];
        page.on("request", (r) => peticiones.push(r.url()));
        page.on("console", (m) => { if (m.type() === "error") erroresConsola.push(m.text()); });
        page.on("pageerror", (e) => erroresConsola.push(String(e)));

        const resp = await page.goto(PANEL + "/", { waitUntil: "networkidle0", timeout: 180000 });
        assert.strictEqual(resp.status(), 200);
        assert.strictEqual(new URL(page.url()).pathname, "/", "la raíz ya no debe redirigir a /login");
        paso("GET / responde 200 sin redirigir");

        const h1 = await page.$eval("h1", (e) => e.textContent.trim());
        assert.strictEqual(h1, "Automatiza tus sorteos de WhatsApp con EFAAT");
        assert.strictEqual(await page.$eval("html", (e) => e.lang), "es");
        assert.match(await page.title(), /EFAAT/);
        paso("título, idioma y metadatos");

        const planes = await page.$$eval("[data-plan]", (els) => els.map((e) => ({
            id: e.dataset.plan,
            texto: e.textContent.replace(/\s+/g, " ")
        })));
        assert.deepStrictEqual(planes.map((p) => p.id), ["esencial", "profesional", "avanzado", "empresarial"]);
        const esperados = [["$49.999", "1 grupo"], ["$139.999", "Hasta 2 grupos"], ["$299.999", "Hasta 5 grupos"], ["$499.999", "Hasta 10 grupos"]];
        planes.forEach((p, i) => esperados[i].forEach((t) => assert.ok(p.texto.includes(t), `${p.id} sin «${t}»`)));
        assert.ok(planes[1].texto.includes("Recomendado") && planes.filter((p) => p.texto.includes("Recomendado")).length === 1);
        paso("cuatro planes con precio COP, límite de grupos y Profesional recomendado");

        const enlaces = await page.$$eval("a[href]", (els) => els.map((a) => a.getAttribute("href")));
        assert.ok(!enlaces.some((h) => h.startsWith("/register")), "la landing no debe abrir el registro comercial");
        assert.ok(!enlaces.some((h) => /terminos|privacidad/i.test(h)), "no hay documentos legales que enlazar");
        assert.ok(enlaces.includes("/login"));
        assert.ok(enlaces.some((h) => h.startsWith("mailto:soporte@efaat.com")));
        const ctaHero = await page.$eval("#inicio a[href='#solicitar-prueba']", (a) => a.textContent.trim());
        assert.match(ctaHero, /Probar gratis 7 días/);
        paso("CTA lleva a la solicitud por correo; sin /register ni enlaces legales inexistentes");

        // ---- demostración: todas las peticiones a partir de aquí ----
        const desde = peticiones.length;
        await page.$eval("#demo", (e) => e.scrollIntoView());

        const pulsarSugerencia = (texto) => page.$$eval("[data-demo] button", (bs, t) => {
            bs.find((b) => b.textContent.trim() === t).click();
        }, texto);
        const ultimoBot = () => page.$$eval("[data-demo] li", (lis) => lis.map((l) => l.textContent).filter((t) => t.startsWith("EFAAT (respuesta")).pop() || "");
        const esperarRespuestas = (n) => page.waitForFunction((k) => [...document.querySelectorAll("[data-demo] li")]
            .filter((l) => l.textContent.startsWith("EFAAT (respuesta")).length >= k, { timeout: 5000 }, n);

        await pulsarSugerencia("Me anotas el 23 y el 45");
        await esperarRespuestas(1);
        assert.match(await ultimoBot(), /23 quedó reservado\. 45 ya estaba ocupado/);
        assert.strictEqual(await page.$eval("[data-numero='23']", (b) => b.dataset.estado), "mio");
        assert.strictEqual(await page.$eval("[data-contador='libres']", (e) => e.textContent), "79");
        assert.ok(await page.$("[aria-label='Reacción automática 👍']"), "falta la reacción simulada");
        paso("reserva parcial simulada: tabla, contador y reacción");

        await pulsarSugerencia("¿Qué números quedan?");
        await esperarRespuestas(2);
        assert.match(await ultimoBot(), /Números disponibles \(79\)/);
        paso("consulta de disponibilidad simulada");

        await page.click("[data-numero='15']");
        assert.strictEqual(await page.$eval("#demo-mensaje", (i) => i.value), "Me anotas el 15");
        await page.click("[data-demo] button[type='submit']");
        await esperarRespuestas(3);
        assert.strictEqual(await page.$eval("[data-numero='15']", (b) => b.dataset.estado), "mio");
        paso("tocar un número libre y enviarlo lo reserva");

        await page.type("#demo-mensaje", "cuáles son mis números");
        await page.keyboard.press("Enter");
        await esperarRespuestas(4);
        assert.match(await ultimoBot(), /tus números son: 15 y 23/);
        paso("mis números simulado");

        await page.$$eval("[data-demo] button", (bs) => bs.find((b) => b.textContent.trim() === "Reiniciar").click());
        assert.strictEqual(await page.$eval("[data-contador='libres']", (e) => e.textContent), "80");
        assert.strictEqual(await page.$eval("[data-numero='23']", (b) => b.dataset.estado), "libre");
        paso("reiniciar devuelve el estado inicial");

        await new Promise((r) => setTimeout(r, 800));
        const durante = peticiones.slice(desde).filter(esPeticionDeDatos);
        const analitica = durante.filter((u) => new URL(u).pathname === "/api/e");
        const prohibidas = durante.filter((u) => new URL(u).pathname !== "/api/e");
        assert.deepStrictEqual(prohibidas, [], "la demo hizo peticiones de datos");
        assert.ok(!peticiones.some((u) => u.startsWith(MUERTO)), "la landing intentó llegar a Supabase/backend");
        paso(`la demo no hizo ninguna petición de datos (analítica de visitas existente: ${analitica.length})`);

        // La landing no muestra errores de consola propios. Se ignoran los
        // del recolector de analítica (su /api/e falla a propósito: el
        // backend apunta a un puerto muerto).
        const propios = erroresConsola.filter((t) => !/api\/e|Failed to load resource/.test(t));
        assert.deepStrictEqual(propios, []);
        paso("sin errores de consola");

        if (CAPTURAS) {
            fs.mkdirSync(CAPTURAS, { recursive: true });
            await page.evaluate(() => window.scrollTo(0, 0));
            await page.screenshot({ path: path.join(CAPTURAS, "escritorio-hero.png") });
            await page.screenshot({ path: path.join(CAPTURAS, "escritorio-completa.png"), fullPage: true });
            await pulsarSugerencia("Me anotas el 23 y el 45");
            await esperarRespuestas(1);
            const demo = await page.$("#demo");
            await demo.screenshot({ path: path.join(CAPTURAS, "escritorio-demo.png") });
        }

        // ---------------------------------------------------- móvil ----
        console.log("Móvil (390×844)");
        const movil = await browser.newPage();
        await movil.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
        await movil.goto(PANEL + "/", { waitUntil: "networkidle0" });
        const desborde = await movil.evaluate(() => {
            const ancho = document.documentElement.clientWidth;
            const anchos = [...document.querySelectorAll("body *")]
                .filter((e) => e.getBoundingClientRect().right > ancho + 1)
                .map((e) => e.tagName + "." + e.className);
            return { scroll: document.documentElement.scrollWidth, ancho, anchos: anchos.slice(0, 5) };
        });
        assert.ok(desborde.scroll <= desborde.ancho, `desborde horizontal: ${JSON.stringify(desborde)}`);
        assert.deepStrictEqual(desborde.anchos, []);
        paso("sin desplazamiento horizontal a 390 px");

        const navVisible = await movil.$eval("nav[aria-label='Secciones']", (n) => getComputedStyle(n).display);
        assert.strictEqual(navVisible, "none");
        const ctaVisible = await movil.$eval("header a[href='#solicitar-prueba']", (a) => a.getBoundingClientRect().width > 0);
        assert.ok(ctaVisible);
        paso("encabezado compacto: inicio de sesión y CTA visibles");

        const celda = await movil.$eval("[data-numero='00']", (b) => b.getBoundingClientRect().width);
        assert.ok(celda >= 24, `celdas demasiado pequeñas: ${celda}px`);
        await movil.$eval("#demo", (e) => e.scrollIntoView());
        await movil.tap("[data-numero='16']");
        await movil.tap("[data-demo] button[type='submit']");
        await movil.waitForFunction(() => document.querySelector("[data-numero='16']").dataset.estado === "mio", { timeout: 5000 });
        paso(`demo usable con toque (celda ${Math.round(celda)} px)`);

        if (CAPTURAS) {
            await movil.evaluate(() => window.scrollTo(0, 0));
            await movil.screenshot({ path: path.join(CAPTURAS, "movil-hero.png") });
            await movil.screenshot({ path: path.join(CAPTURAS, "movil-completa.png"), fullPage: true });
            await (await movil.$("#demo")).screenshot({ path: path.join(CAPTURAS, "movil-demo.png") });
            await (await movil.$("#planes")).screenshot({ path: path.join(CAPTURAS, "movil-planes.png") });
        }

        // --------------------------------------- rutas existentes ----
        console.log("Rutas existentes");
        for (const ruta of ["/login", "/register"]) {
            const p = await browser.newPage();
            const r = await p.goto(PANEL + ruta, { waitUntil: "networkidle0" });
            assert.strictEqual(r.status(), 200);
            assert.strictEqual(new URL(p.url()).pathname, ruta);
            assert.ok(await p.$("input[type='password']"), `${ruta} sin formulario`);
            await p.close();
        }
        paso("/login y /register siguen respondiendo con su formulario");

        console.log(`\n${ok} comprobaciones superadas`);

    } finally {
        if (browser) await browser.close();
        detener(hijo);
    }
}

main().catch((err) => {
    console.error("\n✘", err.message);
    process.exitCode = 1;
});
