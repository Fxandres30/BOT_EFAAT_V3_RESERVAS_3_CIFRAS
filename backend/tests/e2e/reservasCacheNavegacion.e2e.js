// ==========================================================================
// PRUEBA DE EXTREMO A EXTREMO — Reservas conserva el estado de los sorteos
// al entrar y salir de una tabla (caché del índice).
//
//   1. Primera entrada: las tarjetas muestran su sorteo (Programado).
//   2. Entrar a una tabla y volver, 5 veces: NUNCA vuelve a aparecer
//      «Consultando sorteo…» ni el esqueleto; los datos se ven al instante.
//   3. Como mucho UNA consulta de revalidación por regreso (sin duplicados).
//   4. Con el backend caído: al volver se conservan los últimos datos
//      válidos y se avisa; al volver la conexión, el aviso desaparece.
//   5. Sin errores de JavaScript.
//
// ENTORNO AISLADO (tests/e2e/entornoPanel.js): Supabase en memoria, sin
// WhatsApp. No toca datos reales.
//
//     node backend/tests/e2e/reservasCacheNavegacion.e2e.js
// ==========================================================================

const assert = require("assert");
const path = require("path");
const {
    PANEL, tablas: t, registrarUsuario, arrancarEntorno, servirTablas, esperarTexto, textoPagina, fechaColombia, crearPasos
} = require("./entornoPanel");

const RAIZ = path.resolve(__dirname, "../..");
const servicio = require(path.join(RAIZ, "sorteos/servicio.js"));

const TOKEN = "e2e-token-cache-reservas";
const A = "aaaaaaaa-0000-4000-8000-0000000000c1";
registrarUsuario(TOKEN, A, "cache@prueba.local");

t.grupos_autorizados = [{ usuario_id: A, grupo_id: "g1@g.us", activo: true }];
t.grupos = [{ jid: "g1@g.us", nombre: "Grupo Prueba Uno" }];
t.cuentas_pago = [{ id: "cuenta-e2e", usuario_id: A, nombre: "Nequi Prueba", tipo: "nequi", numero: "3000000001", titular: "Prueba", activa: true }];
t.eventos_bot = [];
for (const tabla of ["reservas_dos_cifras", "5k_15k_reservas_2_cifras"]) {
    t[tabla] = Array.from({ length: 100 }, (_, i) => ({ numero: String(i).padStart(2, "0"), estado: "libre", usuario_id: A }));
}

const { paso, terminar } = crearPasos();

// Vigía en la página: cuenta cada vez que aparece «Consultando sorteo…» o el
// esqueleto de carga mientras está armado.
function instalarVigia() {
    window.__vigia = { armado: false, consultando: 0, esqueleto: 0 };
    new MutationObserver(() => {
        const v = window.__vigia;
        if (!v.armado || !document.body) return;
        if (document.body.innerText.includes("Consultando sorteo")) v.consultando++;
        if (document.querySelector('[aria-label="Cargando tablas"]')) v.esqueleto++;
    }).observe(document, { childList: true, subtree: true, characterData: true });
}

async function main() {

    const sorteo = await servicio.crearSorteo(A, {
        modalidad: "dos_cifras", nombre: "Lotería Caché", hora_fin: "22:30", valor: 5000,
        premios: [{ nombre: "Premio mayor", premio: 100000 }], grupos: ["g1@g.us"], cuentas: ["cuenta-e2e"],
        publicar_en: new Date(`${fechaColombia(2)}T08:00:00-05:00`).toISOString(), fecha_sorteo: fechaColombia(2),
        mensajes: { publicacion: "", aviso_cierre: "" }, recordatorios: []
    });
    assert.ok(sorteo.ok, JSON.stringify(sorteo));
    t.sorteos_programados.find(s => s.id === sorteo.data.id).estado = "programado";

    const entorno = await arrancarEntorno();

    try {

        servirTablas(["reservas_dos_cifras", "5k_15k_reservas_2_cifras", "eventos_bot", "reservas_actividad", "tablas_cliente", "tabla_configuracion_visual", "tabla_disenos"]);
        const page = await entorno.nuevaPagina(TOKEN);
        await page.setViewport({ width: 1366, height: 900 });
        await page.evaluateOnNewDocument(instalarVigia);

        const consultas = [];
        let caido = false;
        await page.setRequestInterception(true);
        page.on("request", (req) => {
            const url = req.url();
            if (/\/api\/sorteos\/(activos|gestion)(\?|$)/.test(url)) {
                consultas.push(url);
                if (caido) return req.abort("failed");
            }
            req.continue();
        });

        // 1. Primera entrada.
        await page.goto(`${PANEL}/tablas`, { waitUntil: "domcontentloaded" });
        await esperarTexto(page, "Lotería Caché");
        let texto = await textoPagina(page);
        assert.ok(texto.includes("Programado"), texto.slice(0, 800));
        assert.ok(!texto.includes("Consultando sorteo"));
        paso("primera entrada: las tarjetas muestran su sorteo");

        // 2-3. Entrar a la tabla y volver, varias veces.
        for (let i = 1; i <= 5; i++) {

            await page.click('a[href="/tablas/5000"]');
            await page.waitForFunction(() => location.pathname === "/tablas/5000" && document.querySelector('a[href="/tablas"]'), { timeout: 120000 });
            // Mitad de las vueltas, rápidas; la otra mitad, pasada la vigencia (5 s).
            await new Promise(r => setTimeout(r, i % 2 ? 300 : 6000));

            const antes = consultas.length;
            await page.evaluate(() => Object.assign(window.__vigia, { armado: true, consultando: 0, esqueleto: 0 }));
            await page.click('a[href="/tablas"]');
            await page.waitForFunction(() => location.pathname === "/tablas" && document.body.innerText.includes("Lotería Caché"), { timeout: 120000 });
            await new Promise(r => setTimeout(r, 1500));

            const vigia = await page.evaluate(() => window.__vigia);
            assert.strictEqual(vigia.consultando, 0, `vuelta ${i}: reapareció «Consultando sorteo…»`);
            assert.strictEqual(vigia.esqueleto, 0, `vuelta ${i}: reapareció el esqueleto`);
            const nuevas = consultas.length - antes;
            // activos + gestion = una revalidación.
            assert.ok(nuevas <= 2, `vuelta ${i}: ${nuevas} consultas (duplicadas)`);
            console.log(`   vuelta ${i} (${i % 2 ? "rápida" : "tras 6 s"}): ${nuevas / 2} revalidación(es), sin «Consultando sorteo…»`);
        }
        paso("5 vueltas tabla → Reservas: datos al instante, sin «Consultando sorteo…» ni esqueleto, sin consultas duplicadas");

        // 4. Backend caído.
        await page.click('a[href="/tablas/5000"]');
        await page.waitForFunction(() => location.pathname === "/tablas/5000" && document.querySelector('a[href="/tablas"]'), { timeout: 120000 });
        await new Promise(r => setTimeout(r, 6000));
        caido = true;
        await page.evaluate(() => Object.assign(window.__vigia, { armado: true, consultando: 0, esqueleto: 0 }));
        await page.click('a[href="/tablas"]');
        await esperarTexto(page, "No se pudo actualizar el estado de los sorteos");
        texto = await textoPagina(page);
        assert.ok(texto.includes("Lotería Caché") && texto.includes("Programado"), "se conservan los últimos datos válidos");
        const vigia = await page.evaluate(() => window.__vigia);
        assert.strictEqual(vigia.consultando + vigia.esqueleto, 0, "la interfaz no se vacía");
        paso("backend caído: se conservan los últimos datos válidos y se avisa");

        caido = false;
        await page.click('a[href="/tablas/5000"]');
        await page.waitForFunction(() => location.pathname === "/tablas/5000", { timeout: 120000 });
        await page.click('a[href="/tablas"]');
        await page.waitForFunction(() => !document.body.innerText.includes("No se pudo actualizar el estado"), { timeout: 30000 });
        paso("conexión recuperada: se revalida y el aviso desaparece");

        assert.deepStrictEqual(page.erroresJs, [], page.erroresJs.join("\n"));
        paso("sin errores de JavaScript");

    } finally {
        await entorno.cerrar();
    }

}

terminar(main());
