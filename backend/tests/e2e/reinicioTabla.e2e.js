// ==========================================================================
// PRUEBA DE EXTREMO A EXTREMO — Tablas $3.000 → «Reiniciar»: el
// administrador decide. Navegador real (Chrome vía puppeteer) y panel Next
// real; el reinicio escribe desde el navegador (services/tablas/
// reiniciarTabla.ts) sobre el Supabase falso, como en producción con RLS.
//
//   1. El diálogo muestra el impacto real: estados, la reserva anticipada
//      del sorteo programado (y NO cuenta como anticipadas las del sorteo
//      «fallido» que llegó a publicarse), precios que comparten la tabla.
//   2. Cancelar no toca nada.
//   3. Sin escribir REINICIAR, o sin aceptar las anticipadas, no se puede.
//   4. Si la tabla cambia tras revisar: no se reinicia nada y se explica.
//   5. Con todo confirmado (doble clic incluido): un solo reinicio, las 100
//      del cliente libres, la cuadrícula del OTRO cliente y los sorteos
//      programados intactos; resultado real en pantalla y en la cuadrícula.
//
// ENTORNO AISLADO (tests/e2e/entornoPanel.js): no toca Supabase. No envía
// nada por WhatsApp.
//
//     node backend/tests/e2e/reinicioTabla.e2e.js
// ==========================================================================

const assert = require("assert");
const path = require("path");

const {
    PANEL, tablas: t, registrarUsuario, arrancarEntorno, servirTablas,
    pulsar, esperarTexto, textoPagina, crearPasos
} = require("./entornoPanel");

const RAIZ = path.resolve(__dirname, "../..");

const TOKEN = "e2e-token-reinicio";
const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const T5K = "5k_15k_reservas_2_cifras";

registrarUsuario(TOKEN, A, "reinicio@prueba.local");

t[T5K] = [A, B].flatMap(u => Array.from({ length: 100 }, (_, i) => ({ id: `${u}-${i}`, numero: String(i).padStart(2, "0"), estado: "libre", usuario_id: u })));
const fila = (n, u = A) => t[T5K].find(f => f.numero === n && f.usuario_id === u);
// 03: reserva ANTICIPADA de «Antioqueñita» (programado, sin evento).
Object.assign(fila("03"), { estado: "reservado", identidad_evento_real: "id-antioq", comprador: "Ana", usuario_global_id: "c1", evento_id: null });
// 10 y 11: de «Medellín», sorteo programado 'fallido' que SÍ llegó a publicarse (evento cerrado).
Object.assign(fila("10"), { estado: "pagado", identidad_evento_real: "id-med", comprador: "Luis", evento_id: "ev-med", fecha_pago: "2026-10-23" });
Object.assign(fila("11"), { estado: "reservado", identidad_evento_real: "id-med", comprador: "Luis", evento_id: "ev-med" });
Object.assign(fila("20"), { estado: "bloqueado", temporal_por: "apartado" });
// El mismo número en la cuadrícula de OTRO cliente: nunca se toca.
Object.assign(fila("03", B), { estado: "reservado", identidad_evento_real: "id-b", comprador: "De B" });

t.sorteos_programados = [
    { id: "s-antioq", usuario_id: A, estado: "programado", identidad_evento_real: "id-antioq", tabla: T5K, config: { nombre: "Antioqueñita Día", valor: 3000 } },
    { id: "s-med", usuario_id: A, estado: "fallido", identidad_evento_real: "id-med", tabla: T5K, config: { nombre: "Lotería de Medellín", valor: 5000 } }
];
t.eventos_bot = [
    { id: "ev-med", usuario_id: A, grupo_id: "g1@g.us", activo: false, estado: "cerrado", identidad_evento_real: "id-med", nombre_evento: "Lotería de Medellín", valor: 5000, tabla: T5K, creado_en: "2026-10-23T16:00:00Z" }
];
t.reservas_actividad = [];

const { paso, terminar } = crearPasos();
const DIALOGO = '[role="dialog"][aria-label="Reiniciar la tabla"]';
const botonReiniciar = (page) => page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find(x => x.textContent.trim() === "Reiniciar la tabla");
    return b ? !b.disabled : null;
});
const textoDialogo = (page) => page.$eval(DIALOGO, d => d.innerText);
const reinicios = () => t.reservas_actividad.filter(a => a.tipo === "tabla_reiniciada");

async function abrir(page) {
    await pulsar(page, "Reiniciar");
    await page.waitForSelector(DIALOGO);
    await page.waitForFunction((sel) => /Estado actual/.test(document.querySelector(sel)?.innerText || ""), { timeout: 60000 }, DIALOGO);
}

async function main() {

    servirTablas([T5K, "eventos_bot", "sorteos_programados", "reservas_actividad", "tablas_cliente", "tabla_configuracion_visual", "tabla_disenos"]);

    const entorno = await arrancarEntorno({
        montarBackend: (app) => app.use("/tablas", require(path.join(RAIZ, "routes/tablas.js")))
    });

    try {

        const page = await entorno.nuevaPagina(TOKEN);
        await page.goto(`${PANEL}/tablas/3000`, { waitUntil: "domcontentloaded" });
        await page.waitForSelector('[data-numero="03"]', { timeout: 120000 });
        const sorteosAntes = JSON.stringify(t.sorteos_programados);
        const deB = () => JSON.stringify(t[T5K].filter(f => f.usuario_id === B));
        const deBAntes = deB();

        // 1. Impacto.
        await abrir(page);
        let texto = await textoDialogo(page);
        assert.ok(/Estado actual \(4 ocupados de 100\)/.test(texto), texto);
        assert.ok(/Reservados: 2/.test(texto) && /Pagados: 1/.test(texto) && /Bloqueados: 1/.test(texto), texto);
        assert.ok(texto.includes("1 reserva(s) anticipada(s) de sorteos programados") && texto.includes("«Antioqueñita Día»: 1"), texto);
        assert.ok(!texto.includes("Medellín"), "el sorteo fallido que llegó a publicarse no es anticipado");
        assert.ok(/comparten tus precios \$5\.000, \$7\.000, \$10\.000, \$15\.000/.test(texto), "avisa de los precios que comparten la tabla");
        assert.ok(texto.includes("Incluye 1 número(s) pagado(s)"), "avisa de los pagos");
        paso("el diálogo muestra el impacto real: 4 ocupados, 1 anticipada de «Antioqueñita Día» (Medellín, ya publicado, no cuenta), pagos y precios que comparten la tabla");

        // 2. Cancelar.
        const antes = JSON.stringify(t[T5K]);
        await pulsar(page, "Cancelar");
        await page.waitForFunction((sel) => !document.querySelector(sel), {}, DIALOGO);
        assert.strictEqual(JSON.stringify(t[T5K]), antes, "cancelar no toca nada");
        assert.strictEqual(reinicios().length, 0);
        paso("«Cancelar» cierra sin modificar ningún número");

        // 3. Confirmación obligatoria.
        await abrir(page);
        assert.strictEqual(await botonReiniciar(page), false, "sin confirmar, deshabilitado");
        await page.type('[aria-label="Texto de confirmación"]', "REINICIAR");
        assert.strictEqual(await botonReiniciar(page), false, "con anticipadas, falta aceptarlas");
        await page.evaluate(() => [...document.querySelectorAll("label")].find(l => /Eliminar también/.test(l.textContent)).querySelector("input").click());
        assert.strictEqual(await botonReiniciar(page), true);
        paso("sin escribir REINICIAR y sin aceptar la anticipada no se puede confirmar");

        // 4. La tabla cambia después de revisar: nada se borra.
        Object.assign(fila("40"), { estado: "reservado", comprador: "Nueva", usuario_global_id: "c9" });
        const conNueva = JSON.stringify(t[T5K]);
        await pulsar(page, "Reiniciar la tabla");
        await page.waitForFunction((sel) => /La tabla cambió desde que revisaste/.test(document.querySelector(sel)?.innerText || ""), { timeout: 60000 }, DIALOGO);
        assert.strictEqual(JSON.stringify(t[T5K]), conNueva, "no se reinició nada");
        assert.strictEqual(reinicios().length, 0);
        await pulsar(page, "Revisar de nuevo");
        await page.waitForFunction((sel) => /Estado actual \(5 ocupados de 100\)/.test(document.querySelector(sel)?.innerText || ""), { timeout: 60000 }, DIALOGO);
        assert.strictEqual(await botonReiniciar(page), false, "la confirmación se pide de nuevo");
        paso("si la tabla cambia tras revisar (reserva nueva del 40): no se reinicia nada, se explica y se vuelve a revisar (5 ocupados)");

        // 5. Reinicio confirmado (doble clic).
        await page.type('[aria-label="Texto de confirmación"]', "reiniciar");
        await page.evaluate(() => [...document.querySelectorAll("label")].find(l => /Eliminar también/.test(l.textContent)).querySelector("input").click());
        await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find(x => x.textContent.trim() === "Reiniciar la tabla"); b.click(); b.click(); });
        await page.waitForFunction((sel) => /Tabla reiniciada: 100 números quedan disponibles/.test(document.querySelector(sel)?.innerText || ""), { timeout: 60000 }, DIALOGO);
        texto = await textoDialogo(page);
        assert.ok(texto.includes("Se eliminaron 1 reserva(s) anticipada(s)."), texto);
        assert.ok(t[T5K].filter(f => f.usuario_id === A).every(f => f.estado === "libre" && f.comprador == null && f.usuario_global_id == null && f.evento_id == null && f.fecha_pago == null), "sin datos de reserva");
        assert.strictEqual(deB(), deBAntes, "la cuadrícula del otro cliente no cambia");
        assert.strictEqual(JSON.stringify(t.sorteos_programados), sorteosAntes, "los sorteos programados no se borran ni cambian");
        assert.strictEqual(reinicios().length, 1, "doble clic: un solo reinicio");
        assert.strictEqual(reinicios()[0].detalle.anticipadas_eliminadas, 1);
        await pulsar(page, "Cerrar");
        await page.waitForFunction(() => ["03", "10", "11", "20", "40"].every(n => document.querySelector(`[data-numero="${n}"]`)?.dataset.estado === "libre"), { timeout: 60000 });
        assert.strictEqual((page.erroresJs || []).length, 0, `errores de JavaScript: ${page.erroresJs}`);
        paso("con REINICIAR y la anticipada aceptada (doble clic): un solo reinicio, las 100 libres y sin datos; el otro cliente y los sorteos programados intactos; la cuadrícula lo refleja");

    } finally {
        await entorno.cerrar();
    }

}

terminar(main());
