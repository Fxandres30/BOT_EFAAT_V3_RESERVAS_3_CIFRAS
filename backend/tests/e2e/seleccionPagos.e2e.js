// ==========================================================================
// PRUEBA DE EXTREMO A EXTREMO — Tablas $5.000: «Seleccionar» y operaciones
// por lote (pagar, liberar, desbloquear) + acciones rápidas de «Historial de
// números». Navegador real (Chrome vía puppeteer), panel Next real y API
// real (routes/tablas.js → reservaManual.js: el mismo pago/liberación de un
// número que usa su detalle).
//
//   1. Sin el modo: un clic abre el detalle del número (como siempre).
//   2. Selección en la cuadrícula y en el historial; la barra ofrece solo
//      las operaciones compatibles, con cuántos números admite cada una.
//   3. La selección se conserva al filtrar.
//   4. «Compartir» con selección: imagen idéntica a la de sin selección.
//   5. Pagar (doble clic = un lote), desbloquear, liberar con anulación de
//      pago (motivo obligatorio), error parcial; propietario y sorteo
//      intactos; selección limpia al terminar cada operación.
//   6. Acción rápida desde el historial: opciones según el estado.
//   7. Al cambiar de precio la selección no se arrastra.
//
// ENTORNO AISLADO (tests/e2e/entornoPanel.js): no toca Supabase. WhatsApp es
// SIMULADO: esta prueba NO envía nada real.
//
//     node backend/tests/e2e/seleccionPagos.e2e.js
// ==========================================================================

const assert = require("assert");
const path = require("path");

delete process.env.TABLA_SHARE_SECRET;

const {
    PANEL, tablas: t, registrarUsuario, arrancarEntorno, servirTablas,
    pulsar, esperarTexto, textoPagina, fechaColombia, crearPasos
} = require("./entornoPanel");

const RAIZ = path.resolve(__dirname, "../..");
function inyectar(rutaRel, exportsObj) {
    const abs = path.join(RAIZ, rutaRel);
    require.cache[abs] = { id: abs, filename: abs, loaded: true, exports: exportsObj };
}

const TOKEN = "e2e-token-seleccion";
const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const T5K = "5k_15k_reservas_2_cifras";
const EV = "e0000000-0000-4000-8000-000000000001";

registrarUsuario(TOKEN, A, "seleccion@prueba.local");

// WhatsApp simulado: solo para «Compartir» (comparar la imagen).
const envios = [];
inyectar("services/baileys/send.js", {
    sendImage: async ({ jid, image, caption }) => {
        envios.push({ jid, image, caption });
        // Con E2E_CAPTURAS=<carpeta> se guarda cada imagen enviada para revisarla.
        if (process.env.E2E_CAPTURAS) require("fs").writeFileSync(path.join(process.env.E2E_CAPTURAS, `seleccion-enviada-${envios.length}.png`), image);
    },
    sendMessage: async () => { throw new Error("no debe enviarse texto suelto"); }
});
inyectar("services/baileys/manager.js", { getSocketActivoDe: (u) => (u === A ? { usuario: A } : null) });

t.grupos_autorizados = [{ usuario_id: A, grupo_id: "g1@g.us", activo: true }];
t.grupos = [{ jid: "g1@g.us", nombre: "Rifa uno" }];
t.eventos_bot = [{
    id: EV, usuario_id: A, grupo_id: "g1@g.us", grupo_nombre: "Rifa uno",
    activo: true, abierto: true, estado: "abierto", identidad_evento_real: "ident-activo",
    nombre_evento: "Chontico Noche", hora_fin: "22:30", hora_cierre: "22:26", fecha_evento: fechaColombia(1),
    valor: 5000, premios: [{ tipo: "otro", nombre: "Mayor", premio: 100000 }], tabla: T5K, cifras: 2, cantidad_numeros: 100,
    creado_en: "2026-10-22T12:00:00Z"
}];
t[T5K] = Array.from({ length: 100 }, (_, i) => ({ id: `${A}-${i}`, numero: String(i).padStart(2, "0"), estado: "libre", usuario_id: A }));
const fila = (n) => t[T5K].find(f => f.numero === n);
const reservar = (n, extra) => Object.assign(fila(n), { estado: "reservado", usuario_global_id: "c1", comprador: "María", telefono: "3001112233", contacto: "3001112233", grupo_id: "g1@g.us", evento_id: EV, identidad_evento_real: "ident-activo", fecha_reserva: "2026-10-23", hora_reserva: "09:00:00", ...extra });
// 05: del bot. 12: manual sin teléfono (solo LID). 20: anticipada (sin evento).
reservar("05");
reservar("12", { usuario_global_id: "c2", comprador: "Juan", telefono: null, contacto: null, lid: "222@lid" });
reservar("20", { usuario_global_id: "c2", comprador: "Juan", evento_id: null, identidad_evento_real: "ident-programado" });
for (const n of ["50", "60", "61", "62"]) reservar(n);
Object.assign(fila("30"), { estado: "pagado", usuario_global_id: "c1", comprador: "María", evento_id: EV, identidad_evento_real: "ident-activo", fecha_pago: "2026-10-22", hora_pago: "08:00:00" });
for (const n of ["07", "08"]) Object.assign(fila(n), { estado: "bloqueado", temporal_por: "apartado a mano" });
t.reservas_actividad = [];
t.reservas_auditoria = [];

const { paso, terminar } = crearPasos();

const asociacion = (n) => { const { estado, fecha_pago, hora_pago, ...resto } = fila(n); return JSON.stringify(resto); };
const dialogoNumeroAbierto = (page) => page.evaluate(() => Boolean(document.querySelector('[role="dialog"][aria-label^="Número "]')));
const pulsarCelda = (page, n) => page.click(`[data-numero="${n}"]`);
const marcadas = (page) => page.evaluate(() => [...document.querySelectorAll('[data-numero][aria-pressed="true"]')].map(b => b.dataset.numero).sort());
const botonesBarra = (page) => page.evaluate(() => [...document.querySelectorAll("button")].map(b => b.textContent.trim()).filter(x => /^(Registrar pago|Liberar|Desbloquear) \(\d+\)$/.test(x)));
const VACIA = "Toca los números en la tabla o márcalos en «Historial de números».";

async function marcarEnHistorial(page, n) {
    await page.waitForFunction((n) => [...document.querySelectorAll("label")].some(l => l.textContent.trim() === `Seleccionar el número ${n}`), {}, n);
    await page.evaluate((n) => [...document.querySelectorAll("label")].find(l => l.textContent.trim() === `Seleccionar el número ${n}`).querySelector("input").click(), n);
}

async function seleccionar(page, numeros) {
    for (const n of numeros) await pulsarCelda(page, n);
    await esperarTexto(page, `${numeros.length} seleccionado${numeros.length === 1 ? "" : "s"}`);
}

async function main() {

    // reservas_auditoria: la que escribe el backend en esta prueba. Sin
    // servirla, el Supabase falso respondería [] sin error y el panel
    // tomaría la auditoría por disponible y vacía (el historial perdería
    // los movimientos del panel).
    servirTablas([T5K, "eventos_bot", "reservas_actividad", "reservas_auditoria", "tablas_cliente", "tabla_configuracion_visual", "tabla_disenos"]);

    const entorno = await arrancarEntorno({
        montarBackend: (app) => {
            // Error parcial controlado: el pago del 61 falla en el servidor.
            app.post("/tablas/5000/numeros/61/pagar", (req, res) => res.status(500).json({ ok: false, motivo: "error_guardar", mensaje: "Fallo simulado del servidor." }));
            app.use("/tablas", require(path.join(RAIZ, "routes/tablas.js")));
        }
    });

    try {

        const page = await entorno.nuevaPagina(TOKEN);
        await page.goto(`${PANEL}/tablas/5000`, { waitUntil: "domcontentloaded" });
        await page.waitForSelector('[data-numero="05"]', { timeout: 120000 });
        const antes = Object.fromEntries(["05", "12", "20"].map(n => [n, asociacion(n)]));

        // 0. Imagen de referencia: «Compartir» SIN selección (y grupos guardados).
        await pulsar(page, "Compartir");
        await esperarTexto(page, "Compartir tabla en WhatsApp");
        // Como compartirTabla.e2e.js: esperar la vista previa y los grupos antes de marcar.
        await page.waitForSelector('[aria-label="Vista previa del mensaje"] img', { timeout: 120000 });
        await page.waitForFunction(() => [...document.querySelectorAll("label")].some(l => /Rifa uno/.test(l.textContent) && l.querySelector("input")), { timeout: 60000 });
        await page.evaluate(() => [...document.querySelectorAll("label")].filter(l => /Rifa uno/.test(l.textContent)).forEach(l => l.querySelector("input").click()));
        await pulsar(page, "Continuar");
        await pulsar(page, "Confirmar y enviar");
        await esperarTexto(page, "Publicada en 1 grupo(s).");
        await pulsar(page, "Cerrar");

        // 1. Comportamiento de siempre.
        await pulsarCelda(page, "05");
        await page.waitForSelector('[role="dialog"][aria-label="Número 05"]');
        await page.click('[role="dialog"][aria-label="Número 05"] [aria-label="Cerrar"]');
        await page.waitForFunction(() => !document.querySelector('[role="dialog"][aria-label="Número 05"]'));
        assert.strictEqual(await page.$("[data-numero][aria-pressed]"), null, "sin el modo, las celdas no son seleccionables");
        paso("sin «Seleccionar»: un clic abre el detalle del número, como siempre");

        // 2. Selección en la cuadrícula y en el historial; acciones compatibles.
        await pulsar(page, "Seleccionar");
        await esperarTexto(page, VACIA);
        for (const n of ["05", "12", "20", "30", "00", "45"]) await pulsarCelda(page, n);
        await esperarTexto(page, "6 seleccionados");
        await pulsarCelda(page, "45");
        await esperarTexto(page, "5 seleccionados");
        assert.strictEqual(await dialogoNumeroAbierto(page), false, "en modo selección el clic no abre el detalle");
        assert.deepStrictEqual(await marcadas(page), ["00", "05", "12", "20", "30"]);
        assert.deepStrictEqual(await botonesBarra(page), ["Registrar pago (3)", "Liberar (4)"], "sin «Desbloquear»: ninguno bloqueado");
        await marcarEnHistorial(page, "07");
        await esperarTexto(page, "6 seleccionados");
        assert.deepStrictEqual(await marcadas(page), ["00", "05", "07", "12", "20", "30"], "el historial marca la misma selección");
        assert.deepStrictEqual(await botonesBarra(page), ["Registrar pago (3)", "Liberar (4)", "Desbloquear (1)"]);
        paso("selección en la cuadrícula y en el historial (6); la barra ofrece solo lo compatible: pagar 3, liberar 4, desbloquear 1");

        // 3. La selección se conserva al filtrar.
        await page.select('[aria-label="Filtrar por estado actual"]', "bloqueado");
        await esperarTexto(page, "Cuadrícula filtrada desde «Historial de números»");
        assert.deepStrictEqual(await marcadas(page), ["07"], "filtrada: solo se ve el bloqueado");
        await esperarTexto(page, "6 seleccionados");
        await pulsar(page, "Mostrar todos");
        await page.waitForFunction(() => document.querySelectorAll('[data-numero][aria-pressed="true"]').length === 6);
        paso("filtrar la cuadrícula no pierde la selección (sigue en 6 al volver a mostrar todos)");

        // 4. «Compartir» con selección: imagen limpia. El ratón se aparta de
        // la cuadrícula (en la referencia no había pasado por ella): una
        // celda con :hover se pinta distinta con o sin selección.
        await page.mouse.move(0, 0);
        await new Promise(r => setTimeout(r, 400));   // fin de la transición de 150 ms del :hover
        await pulsar(page, "Compartir");
        await page.waitForFunction(() => document.body.innerText.split("Publicada en 1 grupo(s).").length > 1, { timeout: 120000 });
        await pulsar(page, "Cerrar");
        assert.strictEqual(envios.length, 2);
        assert.ok(envios[0].image.equals(envios[1].image), "la imagen compartida con selección es idéntica a la de sin selección");
        assert.deepStrictEqual(await marcadas(page), ["00", "05", "07", "12", "20", "30"], "la selección sigue tras compartir");
        paso("«Compartir» con números seleccionados: imagen idéntica byte a byte a la de sin selección");

        // 5a. Pagar: solo los reservados; doble clic = un lote.
        await pulsar(page, "Registrar pago (3)");
        await page.waitForSelector('[role="dialog"][aria-label="Registrar pago"]');
        let texto = await textoPagina(page);
        // UX-05: el 20 es de OTRO sorteo (anticipada del programado): fuera
        // por defecto; el administrador lo incluye expresamente.
        assert.ok(texto.includes("Se registrará el pago de 2 números reservados: 05, 12."), texto);
        assert.ok(texto.includes("Incluir 1 número de otro sorteo (20)."), "casilla expresa para el de otro sorteo");
        await page.evaluate(() => [...document.querySelectorAll("label")].find(l => l.textContent.includes("Incluir 1 número de otro sorteo")).querySelector("input").click());
        await esperarTexto(page, "Se registrará el pago de 3 números reservados: 05, 12, 20.");
        texto = await textoPagina(page);
        assert.ok(/00 — Está libre/.test(texto) && /30 — Ya está pagado/.test(texto) && /07 — Está bloqueado/.test(texto), "excluidos con su motivo");
        await page.select('[aria-label="Método de pago"]', "Nequi");
        await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find(x => x.textContent.trim() === "Registrar 3 pagos"); b.click(); b.click(); });
        await esperarTexto(page, "3 pagados");
        texto = await textoPagina(page);
        for (const n of ["05", "12", "20"]) assert.ok(texto.includes(`${n} — Pago registrado.`), `${n} en el resultado`);
        for (const n of ["05", "12", "20"]) {
            assert.strictEqual(fila(n).estado, "pagado", n);
            assert.strictEqual(asociacion(n), antes[n], `${n}: propietario, grupo, evento e identidad intactos`);
        }
        assert.strictEqual(fila("20").evento_id, null, "la anticipada sigue sin evento");
        assert.strictEqual(fila("00").estado, "libre", "el libre no se paga");
        assert.strictEqual(fila("30").fecha_pago, "2026-10-22", "el pagado no se reescribe");
        assert.deepStrictEqual(["05", "12", "20"].map(n => t.reservas_actividad.filter(a => a.numero === n && a.tipo === "pagado").length), [1, 1, 1], "doble clic: un solo pago por número");
        assert.ok(t.reservas_auditoria.filter(a => a.accion === "pagar" && a.resultado === "ok").every(a => a.metodo_pago === "Nequi"), "método del lote en cada pago");
        await pulsar(page, "Cerrar");
        await esperarTexto(page, VACIA);
        assert.deepStrictEqual(await marcadas(page), [], "selección limpia al terminar");
        paso("pagar: 3 reservados (bot, manual sin teléfono, anticipada) pagados una sola vez pese al doble clic; libre, pagado y bloqueado excluidos; propietario y sorteo intactos; selección limpia");

        // 5b. Desbloquear.
        await seleccionar(page, ["07", "08"]);
        assert.deepStrictEqual(await botonesBarra(page), ["Desbloquear (2)"]);
        await pulsar(page, "Desbloquear (2)");
        await esperarTexto(page, "¿Desbloquear los 07, 08?");
        await pulsar(page, "Sí, desbloquear 2");
        await esperarTexto(page, "2 desbloqueados");
        assert.ok(["07", "08"].every(n => fila(n).estado === "libre"));
        await pulsar(page, "Cerrar");
        paso("desbloquear: confirmación «¿Desbloquear los 07, 08?» y ambos quedan libres");

        // 5c. Liberar una reserva y anular un pago: motivo obligatorio.
        await seleccionar(page, ["05", "50"]);
        await pulsar(page, "Liberar (2)");
        await esperarTexto(page, "¿Liberar los 05, 50?");
        await esperarTexto(page, "Incluye pagados (05): se anula su pago. Indica el motivo.");
        const habilitado = () => page.evaluate(() => !([...document.querySelectorAll("button")].find(b => b.textContent.trim() === "Sí, liberar 2")?.disabled));
        assert.strictEqual(await habilitado(), false, "sin motivo no se puede confirmar");
        await page.type('[aria-label="Motivo"]', "Cliente desistió");
        assert.strictEqual(await habilitado(), true);
        await pulsar(page, "Sí, liberar 2");
        await esperarTexto(page, "2 liberados");
        assert.ok(["05", "50"].every(n => fila(n).estado === "libre"));
        assert.deepStrictEqual(t.reservas_actividad.filter(a => ["05", "50"].includes(a.numero) && ["liberado", "cancelado"].includes(a.tipo)).map(a => `${a.numero}:${a.tipo}`).sort(), ["05:cancelado", "50:liberado"]);
        await pulsar(page, "Cerrar");
        paso("liberar: confirmación, anular el pago del 05 exige motivo; 05 y 50 libres y registrados (cancelado / liberado)");

        // 5d. Error parcial.
        await seleccionar(page, ["60", "61"]);
        await pulsar(page, "Registrar pago (2)");
        await pulsar(page, "Registrar 2 pagos");
        await esperarTexto(page, "1 pagado · 1 con error");
        texto = await textoPagina(page);
        assert.ok(texto.includes("61 — Fallo simulado del servidor.") && texto.includes("60 — Pago registrado."), texto);
        assert.strictEqual(fila("60").estado, "pagado");
        assert.strictEqual(fila("61").estado, "reservado", "el que falló sigue reservado");
        await pulsar(page, "Cerrar");
        await pulsar(page, "Terminar");
        paso("error parcial: «1 pagado · 1 con error», con el motivo del 61; el 61 sigue reservado");

        // 6. Acción rápida desde el historial: opciones según el estado.
        // El historial muestra 30 filas por página: se busca el número, como el usuario.
        const buscar = async (texto) => {
            const caja = await page.$('input[type="search"][placeholder^="Buscar número"]');
            await caja.click();
            await page.keyboard.down("Control");
            await page.keyboard.press("KeyA");
            await page.keyboard.up("Control");
            await page.keyboard.press("Backspace");
            await caja.type(texto);
        };
        const opciones = async (n, estado) => {
            await buscar(n);
            try {
                await page.waitForSelector(`[aria-label="Acciones del número ${n} (${estado})"]`, { timeout: 30000 });
            } catch (e) {
                const visto = await page.evaluate(() => ({
                    controles: [...document.querySelectorAll('[aria-label^="Acciones del número"]')].map(b => b.getAttribute("aria-label")),
                    historial: [...document.querySelectorAll("h2")].find(h => h.textContent.startsWith("Historial de números"))?.closest("section")?.innerText.slice(0, 600)
                }));
                throw new Error(`${e.message}\nVisto: ${JSON.stringify(visto)}`);
            }
            await page.click(`[aria-label="Acciones del número ${n} (${estado})"]`);
            await page.waitForSelector(`[role="menu"][aria-label="Acciones del ${n}"]`);
            const r = await page.$$eval(`[role="menu"][aria-label="Acciones del ${n}"] [role="menuitem"]`, bs => bs.map(b => b.textContent.trim()));
            return r;
        };
        // El historial solo lista números con movimientos: el 50 (liberado en 5c) está libre.
        assert.deepStrictEqual(await opciones("50", "Disponible"), ["Ver detalle y reservar"], "un libre nunca se paga desde aquí");
        await page.keyboard.press("Escape");
        assert.deepStrictEqual(await opciones("62", "Reservado"), ["Registrar pago", "Liberar reserva", "Ver detalle"]);
        await page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].find(b => b.textContent.trim() === "Registrar pago").click());
        await page.waitForSelector('[role="dialog"][aria-label="Registrar pago"]');
        await pulsar(page, "Registrar 1 pago");
        await esperarTexto(page, "1 pagado");
        assert.strictEqual(fila("62").estado, "pagado");
        await pulsar(page, "Cerrar");
        paso("historial: el libre solo ofrece «Ver detalle y reservar»; el reservado ofrece pagar/liberar/detalle y se paga con la misma confirmación");

        // 7. Cambiar de precio: la selección no se arrastra.
        await pulsar(page, "Mostrar todos");   // quita la búsqueda del paso 6
        await pulsar(page, "Seleccionar");
        await seleccionar(page, ["70", "71"]);
        const navegacion = await page.evaluate(() => {
            const r = window.next && window.next.router;
            if (!r) return false;
            r.push("/tablas/3000");
            return true;
        });
        if (navegacion) {
            await page.waitForFunction(() => location.pathname === "/tablas/3000", { timeout: 60000 });
            await page.waitForSelector('[data-numero="05"]', { timeout: 120000 });
            await page.evaluate(() => window.next.router.push("/tablas/5000"));
            await page.waitForFunction(() => location.pathname === "/tablas/5000", { timeout: 60000 });
        } else {
            await page.goto(`${PANEL}/tablas/3000`, { waitUntil: "domcontentloaded" });
            await page.goto(`${PANEL}/tablas/5000`, { waitUntil: "domcontentloaded" });
        }
        await page.waitForSelector('[data-numero="70"]', { timeout: 120000 });
        await pulsar(page, "Seleccionar");
        await esperarTexto(page, VACIA);
        assert.deepStrictEqual(await marcadas(page), [], "al volver, ninguna marca del precio anterior");
        assert.strictEqual((page.erroresJs || []).length, 0, `errores de JavaScript: ${page.erroresJs}`);
        paso(`cambiar de precio (${navegacion ? "navegación interna del panel" : "recarga de página"}) limpia la selección; sin errores de JavaScript`);

    } finally {
        await entorno.cerrar();
    }

}

terminar(main());
