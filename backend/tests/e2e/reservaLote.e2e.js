// ==========================================================================
// PRUEBA DE NAVEGADOR — FASE UX-05: selección múltiple y reserva en lote en
// Tablas $5.000. Navegador real (Chrome vía puppeteer), panel Next real y
// API real (routes/tablas.js → reservaManual.js: la MISMA reserva manual de
// un número, con el UPDATE condicionado a 'libre' que usa el bot).
//
// Cada lote es UNA solicitud (POST /api/tablas/lote): se comprueba en las
// peticiones reales del navegador.
//
//   1. «Todos los libres», rango, quitar desde «Ver selección»; la barra
//      ofrece solo lo compatible.
//   2. Reservar 5 libres a un contacto: confirmación con cantidad y números;
//      uno lo toma OTRO justo antes (carrera): se informa y los demás se
//      reservan; nada más cambia.
//   3. Liberar varios reservados.
//   4. Números de otro sorteo: fuera del lote salvo que se marquen.
//   5. Dos pestañas reservan a la vez números que se solapan: cada número
//      queda reservado UNA sola vez.
//   6. Móvil (390 px): barra sin desborde.
//
// ENTORNO AISLADO (tests/e2e/entornoPanel.js): Supabase en memoria; no se
// envía nada por WhatsApp.
//
//     node backend/tests/e2e/reservaLote.e2e.js
// ==========================================================================

const assert = require("assert");
const path = require("path");

const {
    PANEL, fake, tablas: t, registrarUsuario, arrancarEntorno, servirTablas,
    pulsar, esperarTexto, textoPagina, fechaColombia, crearPasos
} = require("./entornoPanel");

const RAIZ = path.resolve(__dirname, "../..");

const TOKEN = "e2e-token-reserva-lote";
const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const T5K = "5k_15k_reservas_2_cifras";
const EV = "e0000000-0000-4000-8000-000000000001";
const C1 = "c1000000-0000-4000-8000-000000000001";
const C2 = "c2000000-0000-4000-8000-000000000002";
const C3 = "c3000000-0000-4000-8000-000000000003";

registrarUsuario(TOKEN, A, "lote@prueba.local");

t.grupos_autorizados = [{ usuario_id: A, grupo_id: "g1@g.us", activo: true }];
t.grupos = [{ jid: "g1@g.us", nombre: "Rifa uno" }];
t.eventos_bot = [{
    id: EV, usuario_id: A, grupo_id: "g1@g.us", grupo_nombre: "Rifa uno",
    activo: true, abierto: true, estado: "abierto", identidad_evento_real: "ident-activo",
    nombre_evento: "Chontico Noche", hora_fin: "22:30", hora_cierre: "22:26", fecha_evento: fechaColombia(1),
    valor: 5000, premios: [{ tipo: "otro", nombre: "Mayor", premio: 100000 }], tabla: T5K, cifras: 2, cantidad_numeros: 100,
    creado_en: "2026-10-22T12:00:00Z"
}];
t.usuarios = [
    { id: C1, nombre: "María Pérez", telefono: "3001112233", lid: null },
    { id: C2, nombre: "Juan Gómez", telefono: "3104445566", lid: null },
    { id: C3, nombre: "Pedro Ruiz", telefono: "3207778899", lid: null }
];
t.contactos_tenant = [C1, C2, C3].map(id => ({ usuario_id: A, usuario_global_id: id, ultimo_visto_en: "2026-10-22T09:00:00Z" }));

t[T5K] = Array.from({ length: 100 }, (_, i) => ({ id: `${A}-${i}`, numero: String(i).padStart(2, "0"), estado: "libre", usuario_id: A }));
const fila = (n) => t[T5K].find(f => f.numero === n);
const ocupar = (n, extra) => Object.assign(fila(n), { estado: "reservado", usuario_global_id: C2, comprador: "Juan Gómez", telefono: "3104445566", contacto: "3104445566", grupo_id: "g1@g.us", evento_id: EV, identidad_evento_real: "ident-activo", fecha_reserva: "2026-10-22", hora_reserva: "08:00:00", ...extra });
ocupar("10");                                                    // del sorteo activo
Object.assign(ocupar("11"), { estado: "pagado", fecha_pago: "2026-10-22", hora_pago: "09:00:00" });
ocupar("12", { evento_id: "ev-viejo", identidad_evento_real: "ident-viejo" });   // de OTRO sorteo
Object.assign(fila("13"), { estado: "bloqueado", temporal_por: "apartado a mano" });
t.reservas_actividad = [];
t.reservas_auditoria = [];

const { paso, terminar } = crearPasos();

const foto = (numeros) => JSON.stringify(numeros.map(n => ({ ...fila(n) })));
const pulsarCelda = (page, n) => page.click(`[data-numero="${n}"]`);
const botonesBarra = (page) => page.evaluate(() => [...document.querySelectorAll("button")].map(b => b.textContent.trim()).filter(x => /^(Reservar|Registrar pago|Liberar|Desbloquear) \(\d+\)$/.test(x)));

// Completa el formulario de reserva (contacto, motivo) del diálogo abierto.
async function completarReserva(page, contacto) {
    await page.waitForSelector('[aria-label="Buscar contacto"]', { timeout: 60000 });
    await page.type('[aria-label="Buscar contacto"]', contacto.split(" ")[0]);
    await page.waitForFunction((c) => [...document.querySelectorAll('[aria-label="Contactos"] button')].some(b => b.textContent.includes(c)), { timeout: 60000 }, contacto);
    await page.evaluate((c) => [...document.querySelectorAll('[aria-label="Contactos"] button')].find(b => b.textContent.includes(c)).click(), contacto);
    await pulsar(page, "Reserva por llamada o mensaje privado");
}

async function main() {

    servirTablas([T5K, "eventos_bot", "reservas_actividad", "reservas_auditoria", "tablas_cliente", "tabla_configuracion_visual", "tabla_disenos"]);

    const entorno = await arrancarEntorno({
        montarBackend: (app) => {
            // Pagar tarda: para ver el estado «Marcando N pagos...» del botón.
            app.post("/tablas/5000/lote", (req, res, next) => {
                if (req.body?.accion === "pagar") setTimeout(next, 700);
                else next();
            });
            app.use("/tablas", require(path.join(RAIZ, "routes/tablas.js")));
        }
    });

    try {

        const page = await entorno.nuevaPagina(TOKEN);
        const errores = page.erroresJs;
        await page.setViewport({ width: 1366, height: 900 });

        // Solicitudes reales del navegador a las operaciones de números.
        let solicitudes = [];
        page.on("request", (r) => {
            if (r.method() === "POST" && /\/api\/tablas\/(lote|numero)/.test(r.url())) solicitudes.push(new URL(r.url()).pathname);
        });
        await page.goto(`${PANEL}/tablas/5000`, { waitUntil: "domcontentloaded" });
        await page.waitForSelector('[data-numero="10"]', { timeout: 120000 });
        await esperarTexto(page, "Seleccionar");

        // 1. Herramientas de selección.
        await pulsar(page, "Seleccionar");
        await pulsar(page, "Todos los libres (96)");
        await esperarTexto(page, "96 seleccionados");
        assert.deepStrictEqual(await botonesBarra(page), ["Reservar (96)"]);
        await pulsar(page, "Limpiar");
        await page.type('[aria-label="Desde"]', "0");
        await page.type('[aria-label="Hasta"]', "05");
        await pulsar(page, "Añadir");
        await esperarTexto(page, "6 seleccionados");
        for (const n of ["10", "11", "12", "13"]) await pulsarCelda(page, n);
        await esperarTexto(page, "10 seleccionados");
        assert.deepStrictEqual(await botonesBarra(page), ["Reservar (6)", "Registrar pago (2)", "Liberar (3)", "Desbloquear (1)"]);
        await pulsar(page, "Ver selección");
        let texto = await textoPagina(page);
        assert.ok(/Libres \(6\)/.test(texto) && /Reservados \(2\)/.test(texto) && /Pagados \(1\)/.test(texto) && /Bloqueados \(1\)/.test(texto), texto);
        assert.ok(texto.includes("otro sorteo"), "el 12 se marca como de otro sorteo");
        await page.click('[aria-label="Quitar 05 de la selección"]');
        await esperarTexto(page, "9 seleccionados");
        paso("«Todos los libres» (96), rango 0–05, celdas sueltas y quitar desde «Ver selección»; la barra ofrece solo lo compatible");

        // 2. Reservar 5 libres; el 03 lo toma otro justo antes.
        const ajenos = foto(["10", "11", "12", "13"]);
        // Carrera: justo antes del UPDATE, OTRO (Pedro) toma el 03.
        fake.control.antesDeEscribir = (tabla) => {
            if (tabla !== T5K) return;
            fake.control.antesDeEscribir = null;
            ocupar("03", { usuario_global_id: C3, comprador: "Pedro Ruiz" });
        };
        solicitudes = [];
        await pulsar(page, "Reservar (5)");
        await page.waitForSelector('[role="dialog"][aria-label="Reservar números"]');
        await esperarTexto(page, "Se reservarán 5 números libres al mismo contacto: 00, 01, 02, 03, 04.");
        texto = await textoPagina(page);
        assert.ok(/10 — Ya está reservado/.test(texto) && /11 — Está pagado/.test(texto) && /13 — Está bloqueado/.test(texto), "excluidos con su motivo");
        await completarReserva(page, "María Pérez");
        await pulsar(page, "Reservar 5 números");
        await esperarTexto(page, "4 reservados");
        assert.deepStrictEqual(solicitudes, ["/api/tablas/lote"], "5 números = UNA sola solicitud");
        texto = await textoPagina(page);
        for (const n of ["00", "01", "02", "04"]) assert.ok(texto.includes(`${n} — Reservado.`), n);
        assert.ok(/03 — Ya no estaba libre \(ahora está reservado\)/.test(texto), "la carrera se informa");
        for (const n of ["00", "01", "02", "04"]) {
            const f = fila(n);
            assert.deepStrictEqual([f.estado, f.usuario_global_id, f.identidad_evento_real, f.evento_id], ["reservado", C1, "ident-activo", EV], n);
        }
        assert.deepStrictEqual([fila("03").usuario_global_id, fila("03").comprador], [C3, "Pedro Ruiz"], "el 03 sigue siendo de quien lo tomó primero");
        assert.strictEqual(foto(["10", "11", "12", "13"]), ajenos, "reservado, pagado, de otro sorteo y bloqueado intactos");
        assert.strictEqual(fila("05").estado, "libre", "el quitado de la selección no se toca");
        const auditadas = t.reservas_auditoria.filter(a => a.accion === "reservar" && a.resultado === "ok").map(a => a.numero).sort();
        assert.deepStrictEqual(auditadas, ["00", "01", "02", "04"], "una auditoría por número reservado");
        await pulsar(page, "Cerrar");
        await esperarTexto(page, "Toca los números en la tabla o márcalos en «Historial de números».");
        paso("reservar 5 en UNA solicitud: confirmación con cantidad y números; 4 reservados a María en el sorteo activo; el 03 (tomado por otro antes) informado y sin pisar; lo demás intacto");

        // 3. Liberar varios reservados.
        await page.waitForFunction(() => document.querySelector('[data-numero="00"]')?.getAttribute("aria-label")?.includes("Reservado"), { timeout: 60000 });
        for (const n of ["00", "01"]) await pulsarCelda(page, n);
        await esperarTexto(page, "2 seleccionados");
        solicitudes = [];
        await pulsar(page, "Liberar (2)");
        await esperarTexto(page, "¿Liberar los 00, 01?");
        await pulsar(page, "Sí, liberar 2");
        await esperarTexto(page, "2 liberados");
        assert.deepStrictEqual(solicitudes, ["/api/tablas/lote"], "2 números = UNA sola solicitud");
        assert.deepStrictEqual(["00", "01"].map(n => fila(n).estado), ["libre", "libre"]);
        assert.deepStrictEqual(["02", "04"].map(n => fila(n).estado), ["reservado", "reservado"], "solo los elegidos");
        await pulsar(page, "Cerrar");
        paso("liberar 2 en UNA solicitud: libres; los demás del lote anterior siguen reservados");

        // 4. Otro sorteo: fuera salvo que se marque.
        const doce = foto(["12"]);
        await page.waitForFunction(() => document.querySelector('[data-numero="00"]')?.getAttribute("aria-label")?.includes("Disponible"), { timeout: 60000 });
        for (const n of ["10", "12"]) await pulsarCelda(page, n);
        await esperarTexto(page, "2 seleccionados");
        await pulsar(page, "Registrar pago (2)");
        await esperarTexto(page, "Se registrará el pago de 1 número reservado: 10.");
        assert.ok((await textoPagina(page)).includes("Incluir 1 número de otro sorteo (12)."));
        solicitudes = [];
        await pulsar(page, "Registrar 1 pago");
        // Respuesta visual: el botón dice qué hace y no admite otro clic.
        await page.waitForFunction(() => [...document.querySelectorAll("button")].some(b => b.textContent.trim() === "Marcando 1 pago..." && b.disabled), { timeout: 5000 });
        await esperarTexto(page, "1 pagado");
        assert.deepStrictEqual(solicitudes, ["/api/tablas/lote"]);
        assert.strictEqual(fila("10").estado, "pagado");
        assert.strictEqual(foto(["12"]), doce, "el de otro sorteo no se tocó");
        await pulsar(page, "Cerrar");
        paso("números de otro sorteo: excluidos por defecto con su casilla; solo se pagó el del sorteo activo; «Marcando 1 pago...» visible y botón deshabilitado");

        // 5. Dos pestañas reservan a la vez números que se solapan.
        const otra = await entorno.nuevaPagina(TOKEN);
        await otra.setViewport({ width: 1366, height: 900 });
        await otra.goto(`${PANEL}/tablas/5000`, { waitUntil: "domcontentloaded" });
        await otra.waitForSelector('[data-numero="20"]', { timeout: 120000 });
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForSelector('[data-numero="20"]', { timeout: 120000 });
        for (const [p, desde, hasta, contacto] of [[page, "20", "24", "María Pérez"], [otra, "22", "26", "Juan Gómez"]]) {
            await pulsar(p, "Seleccionar");
            await p.type('[aria-label="Desde"]', desde);
            await p.type('[aria-label="Hasta"]', hasta);
            await pulsar(p, "Añadir");
            await esperarTexto(p, "5 seleccionados");
            await pulsar(p, "Reservar (5)");
            await p.waitForSelector('[role="dialog"][aria-label="Reservar números"]');
            await completarReserva(p, contacto);
        }
        await Promise.all([pulsar(page, "Reservar 5 números"), pulsar(otra, "Reservar 5 números")]);
        await Promise.all([page, otra].map(p => p.waitForFunction(() => /\d+ reservados?/.test(document.body.innerText) && [...document.querySelectorAll("button")].some(b => b.textContent.trim() === "Cerrar"), { timeout: 120000 })));
        const rango = ["20", "21", "22", "23", "24", "25", "26"].map(n => fila(n));
        assert.ok(rango.every(f => f.estado === "reservado"), JSON.stringify(rango.map(f => f.estado)));
        const reservasPorNumero = (n) => t.reservas_auditoria.filter(a => a.accion === "reservar" && a.resultado === "ok" && a.numero === n).length;
        assert.deepStrictEqual(rango.map(f => reservasPorNumero(f.numero)), [1, 1, 1, 1, 1, 1, 1], "cada número reservado UNA vez");
        assert.deepStrictEqual(["20", "21"].map(n => fila(n).usuario_global_id), [C1, C1]);
        assert.deepStrictEqual(["25", "26"].map(n => fila(n).usuario_global_id), [C2, C2]);
        const textos = [await textoPagina(page), await textoPagina(otra)].join("\n");
        for (const n of ["22", "23", "24"]) {
            const ganador = fila(n).usuario_global_id;
            assert.ok([C1, C2].includes(ganador), n);
            assert.ok(new RegExp(`${n} — (Ya no estaba libre|No está libre)`).test(textos), `${n}: el perdedor lo informa`);
        }
        paso("dos pestañas reservan a la vez 20–24 y 22–26: los 7 números reservados una sola vez; los solapados los gana uno y el otro lo informa");

        // 6. Móvil: barra sin desborde.
        await pulsar(page, "Cerrar");
        await page.setViewport({ width: 390, height: 844 });
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForSelector('[data-numero="30"]', { timeout: 120000 });
        await pulsar(page, "Seleccionar");
        for (const n of ["30", "31"]) await pulsarCelda(page, n);
        await esperarTexto(page, "2 seleccionados");
        const desborde = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        assert.ok(desborde <= 1, `desborde horizontal de ${desborde}px`);
        const visibles = await page.evaluate(() => ["Reservar (2)", "Todos los libres", "Limpiar", "Terminar"].map(t => {
            const b = [...document.querySelectorAll("button")].find(x => x.textContent.trim().startsWith(t));
            const r = b?.getBoundingClientRect();
            return !!r && r.width > 0 && r.left >= 0 && r.right <= innerWidth;
        }));
        assert.deepStrictEqual(visibles, [true, true, true, true], "acciones visibles en 390 px");
        paso("móvil (390 px): barra de selección completa y sin desborde");

        assert.deepStrictEqual(errores, [], "sin errores de JavaScript");
        paso("sin errores de JavaScript");

    } finally {
        await entorno.cerrar();
    }

}

terminar(main());
