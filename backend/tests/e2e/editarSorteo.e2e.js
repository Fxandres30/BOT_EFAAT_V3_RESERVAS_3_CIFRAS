// ==========================================================================
// PRUEBA DE EXTREMO A EXTREMO — EDITAR un sorteo programado desde /sorteos y
// desde el botón «Editar» de /tablas/[precio], con navegador real (Chrome vía
// puppeteer), el panel Next real (next dev) y la API real (routes/sorteos.js).
//
//   1. «Editar» abre «Editar sorteo» con TODOS los datos guardados.
//   2. «Guardar cambios» actualiza el MISMO sorteo (mismo id, versión + 1)
//      y no crea otro.
//   3. Cancelar y volver a editar conserva lo guardado.
//   4. Si el sorteo no se puede cargar: error claro, sin campos y sin poder
//      guardar; «Reintentar» lo carga.
//   5. Los sorteos de otra cuenta no aparecen.
//   6. Tablas → «Editar» sin sorteo programado: lo explica, no abre un
//      formulario vacío en silencio.
//
// ENTORNO AISLADO (tests/e2e/entornoPanel.js): no toca Supabase ni WhatsApp.
//
//     node backend/tests/e2e/editarSorteo.e2e.js
// ==========================================================================

const assert = require("assert");
const path = require("path");
const {
    PANEL, tablas: t, fake, registrarUsuario, arrancarEntorno, servirTablas,
    valorDe, rellenar, marcada, pulsar, botonHabilitado, esperarTexto, textoPagina, fechaColombia, crearPasos
} = require("./entornoPanel");

const RAIZ = path.resolve(__dirname, "../..");
const servicio = require(path.join(RAIZ, "sorteos/servicio.js"));

const TOKEN = "e2e-token-editar";
const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";

registrarUsuario(TOKEN, A, "editar@prueba.local");

t.grupos_autorizados = [
    { usuario_id: A, grupo_id: "g1@g.us", activo: true },
    { usuario_id: A, grupo_id: "g2@g.us", activo: true },
    { usuario_id: B, grupo_id: "gb@g.us", activo: true }
];
t.grupos = [{ jid: "g1@g.us", nombre: "Grupo Prueba Uno" }, { jid: "g2@g.us", nombre: "Grupo Prueba Dos" }, { jid: "gb@g.us", nombre: "Grupo de B" }];
t.cuentas_pago = [
    { id: "cuenta-e2e", usuario_id: A, nombre: "Nequi Prueba", tipo: "nequi", numero: "3000000001", titular: "Prueba", activa: true },
    { id: "cuenta-e2e-2", usuario_id: A, nombre: "Daviplata Prueba", tipo: "daviplata", numero: "3000000002", titular: "Prueba", activa: true },
    { id: "cuenta-b", usuario_id: B, nombre: "Nequi B", tipo: "nequi", numero: "3000000009", activa: true }
];
t.eventos_bot = [];
for (const tabla of ["reservas_dos_cifras", "5k_15k_reservas_2_cifras"]) {
    t[tabla] = [A, B].flatMap(u => Array.from({ length: 100 }, (_, i) => ({ numero: String(i).padStart(2, "0"), estado: "libre", usuario_id: u })));
}

// Diseño válido (mismo formato que tests/sorteos/programacionAvanzada.test.js).
const CONFIG_DISENO = {
    theme: { pageBg: "#08090C", tableBg: "#0F1115", text: "#F2F5FA", border: "#20242C", accent: "#8B7BFF" },
    cells: {
        available: { bg: "#11141A", border: "#2A2F3A", text: "#E6E9EF" },
        reserved: { bg: "#3A1F2B", border: "#E0567A", text: "#FFD9E3" },
        pagado: { bg: "#123326", border: "#3DCB8F", text: "#D9FBEA" }
    },
    numbers: { size: 18, weight: 700 },
    grid: { radius: 10, spacing: 6, borderWidth: 1 }
};

const PUBLICAR = `${fechaColombia(1)}T08:00`;
const FECHA_SORTEO = fechaColombia(2);

const CONFIG = {
    modalidad: "dos_cifras",
    nombre: "Lotería de Medellín",
    hora_fin: "22:30",
    hora_cierre: "22:20",
    valor: 5000,
    premios: [{ nombre: "Premio mayor", premio: 300000 }, { nombre: "Dos últimas", premio: 50000 }],
    grupos: ["g2@g.us"],
    cuentas: ["cuenta-e2e-2"],
    publicar_en: new Date(`${PUBLICAR}:00-05:00`).toISOString(),
    fecha_sorteo: FECHA_SORTEO,
    diseno: { origen: "preset", diseno_id: null, nombre: "Oscuro", config: CONFIG_DISENO },
    mensajes: { publicacion: "Hoy juega {{nombre}} {{cuentas}}", aviso_cierre: "Cerrado" },
    recordatorios: [{ minutos_antes_cierre: 30, texto: "Quedan 30 minutos" }],
    reservas: { liberar_no_pagados: true, vencimiento_minutos: 90 }
};

const { paso, terminar } = crearPasos();

// Botón DENTRO del modal abierto (la tarjeta del sorteo también tiene
// «Cancelar», que cancela el sorteo: nunca se debe pulsar ese).
async function pulsarEnModal(page, texto) {
    await page.waitForFunction((texto) => [...document.querySelectorAll('[role="dialog"] button')].some(b => b.textContent.trim() === texto && !b.disabled), { timeout: 60000 }, texto);
    await page.evaluate((texto) => [...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent.trim() === texto && !b.disabled).click(), texto);
}

async function main() {

    const creado = await servicio.crearSorteo(A, CONFIG);
    assert.ok(creado.ok, JSON.stringify(creado));
    const ID = creado.data.id;
    const deB = await servicio.crearSorteo(B, { ...CONFIG, nombre: "Sorteo de B", grupos: ["gb@g.us"], cuentas: ["cuenta-b"] });
    assert.ok(deB.ok, JSON.stringify(deB));

    const entorno = await arrancarEntorno();

    try {

        const page = await entorno.nuevaPagina(TOKEN);

        // 1. Lista: solo el de A; «Editar» abre la EDICIÓN con todo cargado.
        await page.goto(`${PANEL}/sorteos`, { waitUntil: "domcontentloaded" });
        await esperarTexto(page, "Lotería de Medellín");
        assert.ok(!(await textoPagina(page)).includes("Sorteo de B"), "el sorteo de otra cuenta no aparece");
        paso("/sorteos: solo aparecen los sorteos de la cuenta de la sesión");

        await pulsar(page, "Editar");
        await esperarTexto(page, "Editar sorteo");
        await page.waitForFunction(() => [...document.querySelectorAll("label")].some(l => l.textContent.includes("Lotería o nombre")));
        const titulos = await page.evaluate(() => Array.from(document.querySelectorAll('[role="dialog"] h2'), h => h.textContent.trim()));
        assert.deepStrictEqual(titulos, ["Editar sorteo"], "es la edición, no el modal de sorteo nuevo");
        assert.strictEqual(await botonHabilitado(page, "Guardar cambios"), true);

        assert.strictEqual(await valorDe(page, "Lotería o nombre del sorteo"), "Lotería de Medellín");
        assert.strictEqual(await valorDe(page, "Modalidad"), "dos_cifras");
        assert.strictEqual(await valorDe(page, "Fecha y hora de publicación"), PUBLICAR);
        assert.strictEqual(await valorDe(page, "Fecha del sorteo"), FECHA_SORTEO);
        assert.strictEqual(await valorDe(page, "Hora del sorteo"), "22:30");
        assert.strictEqual(await valorDe(page, "Cierre de reservas"), "22:20");
        assert.strictEqual(await valorDe(page, "Valor por número"), "5000");
        assert.strictEqual(await valorDe(page, "Estilo de la tabla"), "preset:oscuro");
        assert.strictEqual(await valorDe(page, "Mensaje de publicación"), "Hoy juega {{nombre}} {{cuentas}}");
        assert.strictEqual(await valorDe(page, "Aviso al cerrar"), "Cerrado");
        const premios = await page.$$eval('[aria-label="Premio"]', els => Array.from(els, e => e.value));
        const montos = await page.$$eval('[aria-label="Valor del premio"]', els => Array.from(els, e => e.value));
        assert.deepStrictEqual(premios, ["Premio mayor", "Dos últimas"]);
        assert.deepStrictEqual(montos, ["300000", "50000"]);
        await page.waitForFunction(() => document.body.innerText.includes("Grupo Prueba Dos"));
        assert.strictEqual(await marcada(page, "Grupo Prueba Dos"), true);
        assert.strictEqual(await marcada(page, "Grupo Prueba Uno"), false);
        await page.waitForFunction(() => document.body.innerText.includes("Daviplata Prueba"));
        assert.strictEqual(await marcada(page, "Daviplata Prueba"), true);
        assert.strictEqual(await marcada(page, "Nequi Prueba"), false);
        assert.strictEqual(await marcada(page, "Liberar automáticamente"), true);
        assert.strictEqual(await valorDe(page, "Minutos hasta liberar"), "90");
        assert.strictEqual(await marcada(page, "Conservar la tabla actual"), true);
        assert.strictEqual(await marcada(page, "Reiniciar la tabla antes de publicar"), false);
        const recordatorio = await page.$eval('[aria-label="Texto del recordatorio"]', e => e.value);
        assert.strictEqual(recordatorio, "Quedan 30 minutos");
        paso("«Editar» abre «Editar sorteo» con lotería, modalidad, fechas, horas, valor, premios, grupos, cuentas, estilo, mensajes, recordatorios y reservas");

        // 2. Guardar: mismo id, versión 2, sin sorteo nuevo.
        const totalAntes = t.sorteos_programados.length;
        await rellenar(page, "Hora del sorteo", "22:40");
        await pulsarEnModal(page, "Guardar cambios");
        await esperarTexto(page, "Vista previa");
        const guardado = t.sorteos_programados.find(s => s.id === ID);
        assert.strictEqual(t.sorteos_programados.length, totalAntes, "no se creó otro sorteo");
        assert.strictEqual(guardado.version, 2);
        assert.strictEqual(guardado.config.hora_fin, "22:40");
        assert.strictEqual(guardado.config.nombre, "Lotería de Medellín");
        assert.strictEqual(guardado.config.premios.length, 2);
        assert.deepStrictEqual(guardado.config.cuentas, ["cuenta-e2e-2"]);
        assert.strictEqual(guardado.config.fecha_sorteo, FECHA_SORTEO);
        assert.strictEqual(guardado.config.diseno.nombre, "Oscuro");
        assert.strictEqual(guardado.config.recordatorios.length, 1);
        paso("«Guardar cambios» actualiza el MISMO sorteo (versión 2) sin crear otro ni vaciar campos");

        // 3. Cerrar la vista previa y volver a editar: lo guardado.
        await pulsarEnModal(page, "Cerrar");
        await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
        await esperarTexto(page, "Versión 2");
        // Opción de tabla guardada como «Reiniciar la tabla antes de publicar».
        const fila = t.sorteos_programados.find(s => s.id === ID);
        fila.config = { ...fila.config, tabla: { reiniciar: true, liberar_bloqueados: false } };
        await pulsar(page, "Editar");
        await esperarTexto(page, "Editar sorteo");
        await page.waitForFunction(() => [...document.querySelectorAll("label")].some(l => l.textContent.includes("Hora del sorteo")));
        assert.strictEqual(await valorDe(page, "Hora del sorteo"), "22:40");
        assert.strictEqual(await valorDe(page, "Fecha del sorteo"), FECHA_SORTEO);
        assert.strictEqual(await marcada(page, "Reiniciar la tabla antes de publicar"), true, "se conserva la opción guardada");
        assert.strictEqual(await marcada(page, "Conservar la tabla actual"), false);
        assert.ok((await textoPagina(page)).includes("no al programarlo"), "explicación visible");
        await pulsarEnModal(page, "Cancelar");
        await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
        paso("Cancelar y volver a editar conserva los valores guardados (también la opción de la tabla)");

        // 4. Fallo al cargar el sorteo: error, sin campos, sin guardar.
        fake.control.fallarTabla = "sorteos_programados_grupos";
        await pulsar(page, "Editar");
        await esperarTexto(page, "No se pudo cargar el sorteo");
        const conFallo = await textoPagina(page);
        assert.ok(!conFallo.includes("Hora del sorteo"), "no se muestran campos vacíos");
        assert.strictEqual(await botonHabilitado(page, "Guardar cambios"), false);
        const versionAntes = t.sorteos_programados.find(s => s.id === ID).version;
        fake.control.fallarTabla = null;
        await pulsarEnModal(page, "Reintentar");
        await page.waitForFunction(() => [...document.querySelectorAll("label")].some(l => l.textContent.includes("Hora del sorteo")));
        assert.strictEqual(await valorDe(page, "Hora del sorteo"), "22:40");
        assert.strictEqual(t.sorteos_programados.find(s => s.id === ID).version, versionAntes, "el fallo no guardó nada");
        await pulsarEnModal(page, "Cancelar");
        await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
        assert.strictEqual(t.sorteos_programados.find(s => s.id === ID).estado, "borrador", "el sorteo sigue intacto");
        paso("Si el sorteo no carga: error claro, sin formulario vacío ni «Guardar cambios»; «Reintentar» lo carga");

        // 5. Tablas → «Editar» en un precio sin sorteo programado.
        servirTablas(["reservas_dos_cifras", "5k_15k_reservas_2_cifras", "eventos_bot", "reservas_actividad", "tablas_cliente", "tabla_configuracion_visual", "tabla_disenos"]);
        await page.goto(`${PANEL}/tablas/1000`, { waitUntil: "domcontentloaded" });
        await pulsar(page, "Editar");
        await esperarTexto(page, "no tiene ningún sorteo activo ni programado");
        const tablasTexto = await textoPagina(page);
        assert.ok(!tablasTexto.includes("Hora del sorteo"), "no abre un formulario vacío por su cuenta");
        assert.strictEqual(await botonHabilitado(page, "Crear sorteo nuevo"), true);
        paso("Tablas → «Editar» sin sorteo activo ni programado: lo explica y solo crea uno nuevo si se pide");

        // 6. Tablas → «Editar» en el precio del sorteo: edición del MISMO sorteo.
        await page.goto(`${PANEL}/tablas/5000`, { waitUntil: "domcontentloaded" });
        await pulsar(page, "Editar");
        await esperarTexto(page, "Editar sorteo");
        await page.waitForFunction(() => [...document.querySelectorAll("label")].some(l => l.textContent.includes("Hora del sorteo")));
        assert.strictEqual(await valorDe(page, "Lotería o nombre del sorteo"), "Lotería de Medellín");
        assert.strictEqual(await valorDe(page, "Hora del sorteo"), "22:40");
        paso("Tablas → «Editar» en el precio del sorteo abre la edición con sus datos");

        assert.deepStrictEqual(page.erroresJs, [], `errores de JavaScript: ${page.erroresJs.join(" | ")}`);
        paso("sin errores de JavaScript en el navegador");

    } finally {
        await entorno.cerrar();
    }

}

terminar(main());
