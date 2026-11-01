// ==========================================================================
// PRUEBA DE EXTREMO A EXTREMO — Tablas $5.000 → «Editar» con un sorteo
// DETECTADO por el bot (no creado desde el panel), con navegador real
// (Chrome vía puppeteer), panel Next real y API real (routes/sorteos.js).
//
//   1. «Editar» abre «Editar sorteo activo» con los datos del evento
//      detectado (no «Nuevo sorteo» ni «no se editan aquí»).
//   2. Los campos de identidad (lotería, fecha, hora, valor) llegan con sus
//      datos, corregibles solo con confirmación, explicando por qué.
//   3. «Guardar cambios» actualiza el MISMO evento y sus grupos; sin
//      duplicados; reservas y pagos intactos.
//   4. Eventos → «Administrar sorteo» → «Editar» abre el mismo editor (la
//      antigua pestaña «En curso» de /sorteos vive ahora en Eventos); el de
//      otra cuenta no aparece.
//   5. «Mensaje de publicación»: vacío en un detectado (el bot no guarda el
//      texto del anuncio), sin interruptor de activo; se escribe, se guarda
//      y se vuelve a ver.
//
// ENTORNO AISLADO (tests/e2e/entornoPanel.js): no toca Supabase ni WhatsApp.
//
//     node backend/tests/e2e/editarSorteoActivo.e2e.js
// ==========================================================================

const assert = require("assert");
const {
    PANEL, tablas: t, registrarUsuario, arrancarEntorno, servirTablas,
    valorDe, rellenar, rellenarAria, pulsar, esperarTexto, textoPagina, fechaColombia, crearPasos
} = require("./entornoPanel");

const TOKEN = "e2e-token-activo";
const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const T5K = "5k_15k_reservas_2_cifras";
const EV_G1 = "e0000000-0000-4000-8000-000000000001";
const EV_G2 = "e0000000-0000-4000-8000-000000000002";
const EV_B = "e0000000-0000-4000-8000-0000000000b1";

registrarUsuario(TOKEN, A, "activo@prueba.local");

// El sorteo se juega mañana: su cierre siempre está en el futuro.
const MANANA = fechaColombia(1);
const PREMIOS = [{ tipo: "otro", nombre: "Premio mayor", premio: 100000 }];

const evento = (id, usuario, grupo, identidad, extra = {}) => ({
    id, usuario_id: usuario, session_id: "ses-e2e", grupo_id: grupo, grupo_nombre: `Grupo ${grupo.slice(0, 2)}`,
    activo: true, abierto: true, estado: "abierto", identidad_evento_real: identidad,
    nombre_evento: "Chontico Noche", hora_fin: "22:30", hora_cierre: "22:26", fecha_evento: MANANA,
    valor: 5000, premios: PREMIOS, tabla: T5K, cifras: 2, cantidad_numeros: 100,
    creado_en: "2026-10-15T12:00:00Z", reservados: 1, pagados: 2, libres: 97, pendientes: 1, ...extra
});

t.grupos_autorizados = [{ usuario_id: A, grupo_id: "g1@g.us", activo: true }, { usuario_id: A, grupo_id: "g2@g.us", activo: true }];
t.eventos_bot = [
    evento(EV_G1, A, "g1@g.us", "det-a"),
    evento(EV_G2, A, "g2@g.us", "det-a", { creado_en: "2026-10-15T11:00:00Z" }),
    evento(EV_B, B, "g1@g.us", "det-b", { nombre_evento: "Secreto de B" })
];
t[T5K] = [A, B].flatMap(u => Array.from({ length: 100 }, (_, i) => ({ id: `${u}-${i}`, numero: String(i).padStart(2, "0"), estado: "libre", usuario_id: u })));
const filaA = (n) => t[T5K].find(f => f.usuario_id === A && f.numero === n);
Object.assign(filaA("01"), { estado: "pagado", identidad_evento_real: "det-a", evento_id: EV_G1, comprador: "Ana" });
Object.assign(filaA("02"), { estado: "pagado", identidad_evento_real: "det-a", evento_id: EV_G1, comprador: "Luis" });
Object.assign(filaA("03"), { estado: "reservado", identidad_evento_real: "det-a", evento_id: EV_G2, comprador: "Eva" });
t.reservas_dos_cifras = Array.from({ length: 100 }, (_, i) => ({ numero: String(i).padStart(2, "0"), estado: "libre", usuario_id: A }));

const { paso, terminar } = crearPasos();

// Espera un MODAL por su título (h2 del diálogo) y pulsa botones dentro de él.
const esperarModal = (page, titulo, timeout = 60000) =>
    page.waitForFunction((titulo) => [...document.querySelectorAll('[role="dialog"] h2')].some(h => h.textContent.trim() === titulo), { timeout }, titulo);

async function pulsarEnModal(page, texto) {
    await page.waitForFunction((texto) => [...document.querySelectorAll('[role="dialog"] button')].some(b => b.textContent.trim() === texto && !b.disabled), { timeout: 60000 }, texto);
    await page.evaluate((texto) => [...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent.trim() === texto && !b.disabled).click(), texto);
}

// El editor del mensaje aparece cuando carga el catálogo de diseños.
const esperarMensaje = (page, timeout = 60000) =>
    page.waitForFunction(() => !document.body.innerText.includes("Cargando los diseños del mensaje")
        && [...document.querySelectorAll("label")].some(l => l.textContent.trim().startsWith("Mensaje de publicación")), { timeout });

async function main() {

    // La pantalla de Tablas lee la cuadrícula y el evento desde el navegador.
    servirTablas([T5K, "eventos_bot", "reservas_actividad", "tablas_cliente", "tabla_configuracion_visual", "tabla_disenos"]);

    const entorno = await arrancarEntorno();

    try {

        const page = await entorno.nuevaPagina(TOKEN);
        const tablaAntes = JSON.stringify(t[T5K]);
        const totalEventos = t.eventos_bot.length;

        // 1. Tablas $5.000 → Editar: el sorteo detectado, no «Nuevo sorteo».
        await page.goto(`${PANEL}/tablas/5000`, { waitUntil: "domcontentloaded" });
        await pulsar(page, "Editar");
        await esperarTexto(page, "Editar sorteo activo");
        await esperarTexto(page, "Detectado en el grupo");
        const texto = await textoPagina(page);
        assert.ok(!texto.includes("no se editan aquí") && !texto.includes("Crear sorteo nuevo"), "ni el mensaje antiguo ni un sorteo nuevo");
        const titulos = await page.evaluate(() => Array.from(document.querySelectorAll('[role="dialog"] h2'), h => h.textContent.trim()));
        assert.deepStrictEqual(titulos, ["Editar sorteo activo"]);
        paso("Tablas $5.000 → «Editar» abre el sorteo DETECTADO por el bot (no «Nuevo sorteo»)");

        // 2. Datos cargados. La identidad (lotería, fecha, hora, valor) se
        // muestra en sus campos: corregible solo con confirmación expresa.
        assert.strictEqual(await valorDe(page, "Lotería o nombre del sorteo"), "Chontico Noche");
        assert.strictEqual(await valorDe(page, "Fecha del sorteo"), MANANA);
        assert.strictEqual(await valorDe(page, "Hora del sorteo"), "22:30");
        assert.strictEqual(await valorDe(page, "Valor por número"), "5000");
        for (const t1 of ["Grupo g1", "Grupo g2"]) assert.ok(texto.includes(t1), t1);
        assert.ok(/1\s+reservado\(s\) y 2\s+pagado\(s\)/.test(texto), "reservas y pagos en curso");
        assert.ok(/Forma la identidad del sorteo en curso/.test(texto), "motivo: corregir la identidad exige confirmarlo");
        assert.ok(!texto.includes("Confirmo la corrección"), "sin cambios, no se pide confirmar nada");
        assert.ok(/no guardan cuentas de pago/.test(texto), "cuentas: limitación documentada, sin inventar");
        assert.ok(!texto.includes("Secreto de B"));
        assert.strictEqual(await valorDe(page, "Cierre de reservas"), "22:26");
        const premios = await page.evaluate(() => Array.from(document.querySelectorAll('[aria-label="Premio"]'), e => e.value));
        assert.deepStrictEqual(premios, ["Premio mayor"]);
        await esperarMensaje(page);
        assert.strictEqual(await valorDe(page, "Mensaje de publicación"), "", "detectado sin texto: vacío, nada inventado");
        assert.ok(!(await textoPagina(page)).includes("Publicar este mensaje con la imagen"), "detectado: sin interruptor (EFAAT no publica su anuncio)");
        paso("muestra lotería, fecha, hora, valor, grupos, reservas y premios; la identidad solo se corrige confirmándolo");

        // 3. Guardar sobre el MISMO evento (y su otro grupo).
        await rellenarAria(page, "Valor del premio", "150000");
        await rellenar(page, "Mensaje de publicación", "Chontico Noche: anuncio del grupo");
        await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent.trim() === "Guardar cambios").click());
        await page.waitForFunction(() => !document.querySelector('[role="dialog"]'), { timeout: 60000 });
        for (const id of [EV_G1, EV_G2]) {
            const e = t.eventos_bot.find(x => x.id === id);
            assert.strictEqual(e.premios[0].premio, 150000, id);
            assert.strictEqual(e.identidad_evento_real, "det-a");
            assert.strictEqual(e.usuario_id, A);
        }
        assert.strictEqual(t.eventos_bot.length, totalEventos, "sin eventos nuevos");
        assert.strictEqual((t.sorteos_programados || []).length, 0, "no se creó ningún sorteo programado");
        assert.strictEqual(JSON.stringify(t[T5K]), tablaAntes, "reservas y pagos intactos");
        assert.strictEqual(t.eventos_bot.find(x => x.id === EV_B).premios[0].premio, 100000, "el de la otra cuenta no cambia");
        for (const id of [EV_G1, EV_G2]) assert.strictEqual(t.eventos_bot.find(x => x.id === id).publicacion_panel?.texto, "Chontico Noche: anuncio del grupo", id);
        assert.ok(!t.eventos_bot.find(x => x.id === EV_B).publicacion_panel, "el texto no llega a la otra cuenta");
        paso("«Guardar cambios» actualiza el MISMO evento y su otro grupo; sin duplicados; reservas y pagos intactos");

        // 4. Eventos (donde vive ahora la antigua pestaña «En curso»):
        // «Administrar sorteo» → «Editar» abre el mismo editor con lo guardado.
        await page.goto(`${PANEL}/eventos?sorteo=${EV_G1}`, { waitUntil: "domcontentloaded" });
        await esperarModal(page, "Administrar sorteo");
        assert.ok((await textoPagina(page)).includes("Chontico Noche"));
        assert.ok(!(await textoPagina(page)).includes("Secreto de B"), "el sorteo de otra cuenta no aparece");
        await pulsarEnModal(page, "Editar");
        await esperarModal(page, "Editar sorteo activo");
        await page.waitForFunction(() => document.querySelectorAll('[aria-label="Valor del premio"]').length > 0);
        const monto = await page.evaluate(() => document.querySelector('[aria-label="Valor del premio"]').value);
        assert.strictEqual(monto, "150000", "lo guardado");
        await esperarMensaje(page);
        assert.strictEqual(await valorDe(page, "Mensaje de publicación"), "Chontico Noche: anuncio del grupo", "el texto guardado");
        paso("Eventos → «Administrar sorteo» → «Editar» abre el mismo editor con lo guardado (sin el de otra cuenta)");

        assert.deepStrictEqual(page.erroresJs, [], `errores de JavaScript: ${page.erroresJs.join(" | ")}`);
        paso("sin errores de JavaScript en el navegador");

    } finally {
        await entorno.cerrar();
    }

}

terminar(main());
