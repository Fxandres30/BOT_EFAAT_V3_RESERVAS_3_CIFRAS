// ==========================================================================
// PRUEBA DE NAVEGADOR — FASE UX-02: Eventos como centro de control de los
// sorteos, con dos formas de publicar (Programar sorteo / Publicar ahora).
//
// Chrome (puppeteer) + panel real (next dev) + API real del backend
// (routes/sorteos.js) sobre Supabase EN MEMORIA y un WhatsApp SIMULADO. Los
// tres orígenes salen de su camino real:
//   - detectado: filas de eventos_bot en dos grupos, como las guarda el bot;
//   - programado: servicio.crearSorteo + confirmar + publicador.tick;
//   - instantáneo: creado y publicado desde el panel («Publicar ahora»).
// Nada sale a Supabase ni a WhatsApp reales.
//
//     node backend/tests/e2e/centroEventos.e2e.js
// ==========================================================================

process.env.GROUP_QUEUE_DELAY_MS = "0";

const assert = require("assert");
const path = require("path");

const {
    PANEL, tablas: t, servirTablas, registrarUsuario, arrancarEntorno,
    rellenar, rellenarAria, marcar, pulsar, esperarTexto, textoPagina, captura, fechaColombia, crearPasos
} = require("./entornoPanel");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);

const servicio = require(r("sorteos/servicio.js"));
const publicador = require(r("sorteos/publicador.js"));
const destinos = require(r("services/destinosCompartir.js"));
const { compartirEnGrupos } = require(r("services/compartirTabla.js"));
const { ejecutarUnaVez } = require(r("automation/executionGuard.js"));
const { guardarEvento } = require(r("bot/funciones/eventos/guardarEvento.js"));
const { consultarEventoDelSorteo } = require(r("bot/funciones/eventos/consultarEvento.js"));
const { abrirGrupo } = require(r("bot/funciones/eventos/grupos/abrirGrupo.js"));
const { actualizarEvento } = require(r("bot/funciones/reservas/actualizarEvento.js"));

const TOKEN = "e2e-token-centro-eventos";
const A = "aaaaaaaa-0000-4000-8000-00000000000a";
registrarUsuario(TOKEN, A, "centro@prueba.local");

const GRUPOS = ["Uno", "Dos", "Tres", "Cuatro", "Cinco", "Seis"].map((n, i) => ({ jid: `g${i + 1}@g.us`, nombre: `Grupo ${n}` }));
t.grupos_autorizados = GRUPOS.map(g => ({ usuario_id: A, grupo_id: g.jid, activo: true }));
t.grupos = GRUPOS.map(g => ({ jid: g.jid, nombre: g.nombre }));
t.cuentas_pago = [{ id: "cuenta-e2e", usuario_id: A, nombre: "Nequi Prueba", tipo: "nequi", numero: "3000000001", titular: "Prueba", activa: true }];
for (const tabla of ["reservas_dos_cifras", "5k_15k_reservas_2_cifras"]) {
    t[tabla] = Array.from({ length: 100 }, (_, i) => ({ numero: String(i).padStart(2, "0"), estado: "libre", usuario_id: A }));
}

// 1) DETECTADO por el bot en WhatsApp: una fila por grupo, misma identidad.
const MANANA = fechaColombia(1);
const detectado = (id, g) => ({
    id, usuario_id: A, identidad_evento_real: `chontico-noche-${MANANA}`, nombre_evento: "Chontico Noche",
    grupo_id: g.jid, grupo_nombre: g.nombre, activo: true, abierto: true, estado: "abierto",
    hora_fin: "22:30", hora_cierre: "22:26", fecha_evento: MANANA, valor: "5000", cifras: 2, cantidad_numeros: 100,
    tabla: "5k_15k_reservas_2_cifras", premios: [], reservados: 0, pagados: 0, pendientes: 0, libres: 100,
    creado_en: new Date().toISOString(), actualizado_en: new Date().toISOString()
});
t.eventos_bot = [
    // Ids UUID, como en producción (la API valida el formato).
    detectado("dddddddd-0000-4000-8000-000000000001", GRUPOS[0]),
    detectado("dddddddd-0000-4000-8000-000000000002", GRUPOS[1])
];
// El panel lee eventos_bot de Supabase (la misma base en memoria).
servirTablas(["eventos_bot"]);

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const enviados = [];
const sock = {
    context: { usuarioId: A, sessionId: "ses-e2e", telefono: "573000000000" },
    user: { id: "573000000000:1@s.whatsapp.net" },
    groupMetadata: async (jid) => ({ subject: `Nombre ${jid}`, participants: [{}, {}] }),
    groupSettingUpdate: async () => {},
    sendMessage: async (jid, contenido) => {
        enviados.push({ jid, texto: contenido.caption ?? contenido.text });
        return { key: { id: `msg-${enviados.length}` } };
    }
};
const deps = {
    supabase: require(r("lib/supabase.js")),
    guardarEvento, consultarEventoDelSorteo, abrirGrupo, ejecutarUnaVez, actualizarEvento,
    puedeActuar: () => true,
    capturarImagen: async () => PNG,
    textoParaCompartir: destinos.textoParaCompartir,
    compartirEnGrupos,
    sendMessage: async () => { throw new Error("el anuncio nunca sale como texto"); }
};
servicio.instantaneo._socketDe = (u) => (u === A ? sock : null);
servicio.instantaneo._deps = deps;

const entrada = (nombre, grupos, publicarEn) => ({
    modalidad: "dos_cifras", nombre, hora_fin: "22:30", valor: 5000, fecha_sorteo: MANANA,
    premios: [{ nombre: "Premio mayor", premio: 300000 }], grupos, cuentas: ["cuenta-e2e"],
    publicar_en: publicarEn.toISOString(), mensajes: { publicacion: "{{nombre}} {{fecha}}", aviso_cierre: "" }, recordatorios: []
});

async function programar(nombre, grupos, publicarEn) {
    const c = await servicio.crearSorteo(A, entrada(nombre, grupos, publicarEn));
    assert.ok(c.ok, JSON.stringify(c));
    const conf = await servicio.confirmar(A, c.data.id, { version: c.data.version, confirmacion: true });
    assert.ok(conf.ok, JSON.stringify(conf));
    return conf.data;
}

const tarjetas = (page) => page.evaluate(() => [...document.querySelectorAll("article")].map(a => ({
    nombre: a.querySelector("h3")?.textContent.trim(), texto: a.innerText
})));

const { paso, terminar } = crearPasos();

async function main() {

    // 2) PROGRAMADOS: uno pendiente (mañana, Grupo Seis) y otro que el
    //    publicador real publica ya en los grupos 3 y 4.
    const enDosMinutos = new Date(Date.now() + 2 * 60 * 1000);
    const pendiente = await programar("Lotería E2E Pendiente", [GRUPOS[5].jid], new Date(`${MANANA}T13:00:00Z`));
    const programado = await programar("Lotería E2E Programada", [GRUPOS[2].jid, GRUPOS[3].jid], enDosMinutos);
    await publicador.tick(sock, { ahora: new Date(enDosMinutos.getTime() + 60 * 1000), deps });
    const gruposProg = t.sorteos_programados_grupos.filter(g => g.sorteo_id === programado.id);
    assert.deepStrictEqual(gruposProg.map(g => g.estado), ["publicado", "publicado"], JSON.stringify(gruposProg));
    assert.ok(gruposProg.every(g => g.evento_bot_id), "cada grupo enlaza su evento");
    assert.strictEqual(t.sorteos_programados_grupos.find(g => g.sorteo_id === pendiente.id).estado, "pendiente");

    const entorno = await arrancarEntorno();

    try {

        const page = await entorno.nuevaPagina(TOKEN);
        const errores = page.erroresJs;
        await page.setViewport({ width: 1366, height: 900 });

        // A. Programados: antes de publicarse el pendiente y el ya publicado
        //    están aquí (con su estado); nada instantáneo.
        await page.goto(`${PANEL}/sorteos`, { waitUntil: "domcontentloaded" });
        await esperarTexto(page, "Lotería E2E Pendiente");
        await esperarTexto(page, "Lotería E2E Programada");
        let texto = await textoPagina(page);
        assert.ok(texto.includes("Sorteos programados") && /Programados \(2\)/.test(texto), "título y contador");
        assert.ok(!texto.includes("Administrar ("), "sin la pestaña «Administrar» duplicada");
        const menu = await page.evaluate(() => [...document.querySelectorAll("nav a")].map(a => a.textContent.trim()));
        const i = menu.indexOf("Eventos");
        assert.deepStrictEqual(menu.slice(i, i + 4), ["Eventos", "Programados", "Publicar ahora", "Calendario de loterías"], JSON.stringify(menu));
        await captura(page, "centro_programados_antes");
        paso("Programados: el pendiente y el ya publicado, sin «Administrar»; menú Eventos → Programados → Publicar ahora → Calendario");

        // B. Publicar ahora: instantáneo creado y publicado desde el panel.
        await page.goto(`${PANEL}/sorteo-instantaneo`, { waitUntil: "domcontentloaded" });
        await esperarTexto(page, "Todavía no has publicado sorteos instantáneos");
        await pulsar(page, "Publicar sorteo ahora");
        await esperarTexto(page, "Grupo Cinco");
        await esperarTexto(page, "Nequi Prueba");
        await rellenar(page, "Lotería o nombre del sorteo", "Lotería E2E Instantánea");
        await rellenar(page, "Hora del sorteo", "23:50");
        await rellenar(page, "Valor por número", "5000");
        await rellenarAria(page, "Premio", "Premio mayor");
        await rellenarAria(page, "Valor del premio", "300000");
        await marcar(page, "Grupo Cinco");
        await marcar(page, "Nequi Prueba");
        await pulsar(page, "Guardar y ver vista previa");
        await page.waitForSelector('img[alt="Imagen de la tabla que se compartirá por WhatsApp"]', { timeout: 60000 });
        await marcar(page, "Revisé la fecha");
        await pulsar(page, "Publicar ahora");
        await esperarTexto(page, "Enviado en 1 de 1 grupo(s).");
        await pulsar(page, "Cerrar");
        await esperarTexto(page, "Lotería E2E Instantánea");
        texto = await textoPagina(page);
        assert.ok(!texto.includes("Lotería E2E Programada") && !texto.includes("Lotería E2E Pendiente"), "solo instantáneos aquí");
        const instantaneo = t.sorteos_programados.find(s => s.config?.publicacion_inmediata === true);
        assert.ok(instantaneo && instantaneo.estado === "publicado", JSON.stringify(instantaneo));
        paso("«Publicar sorteo ahora» → vista previa → «Publicar ahora»: publicado en Grupo Cinco; la lista solo muestra instantáneos");

        // C. Programados NO muestra el instantáneo publicado.
        await page.goto(`${PANEL}/sorteos`, { waitUntil: "domcontentloaded" });
        await esperarTexto(page, "Lotería E2E Pendiente");
        texto = await textoPagina(page);
        assert.ok(!texto.includes("Lotería E2E Instantánea"), "el instantáneo no está en Programados");
        assert.ok(/Programados \(2\)/.test(texto), "siguen siendo 2");
        paso("Programados no muestra el instantáneo (ni antes ni después de publicarse)");

        // D. Eventos: los tres orígenes, una tarjeta por sorteo real.
        await page.goto(`${PANEL}/eventos`, { waitUntil: "domcontentloaded" });
        await esperarTexto(page, "Chontico Noche");
        await esperarTexto(page, "Lotería E2E Instantánea");
        await esperarTexto(page, "Detectado en WhatsApp");
        const lista = await tarjetas(page);
        const nombres = lista.map(x => x.nombre);
        for (const n of ["Chontico Noche", "Lotería E2E Programada", "Lotería E2E Instantánea"]) {
            assert.strictEqual(nombres.filter(x => x === n).length, 1, `${n} una sola vez: ${nombres.join(" | ")}`);
        }
        assert.ok(!nombres.includes("Lotería E2E Pendiente"), "el pendiente aún no está en Eventos");
        const de = (n) => lista.find(x => x.nombre === n).texto;
        // Los grupos de cada sorteo se resumen en la tarjeta («N grupos», desplegable).
        assert.ok(de("Chontico Noche").includes("Detectado en WhatsApp") && de("Chontico Noche").includes("2 grupos"), de("Chontico Noche"));
        assert.ok(de("Lotería E2E Programada").includes("Programado") && de("Lotería E2E Programada").includes("2 grupos"), de("Lotería E2E Programada"));
        assert.ok(de("Lotería E2E Instantánea").includes("Publicado ahora"), de("Lotería E2E Instantánea"));
        for (const n of ["Chontico Noche", "Lotería E2E Programada", "Lotería E2E Instantánea"]) {
            assert.ok(de(n).includes("Administrar sorteo") && de(n).includes("Ver tabla de reservas"), `${n}: acciones`);
        }
        texto = await textoPagina(page);
        assert.ok(/Activos\s*3/.test(texto), "3 activos (no 5 filas de grupo)");
        assert.ok(texto.includes("Programar sorteo") && texto.includes("Publicar sorteo ahora"), "las dos formas de crear");
        await captura(page, "centro_eventos");
        paso("Eventos: detectado, programado y publicado ahora, una tarjeta cada uno con sus grupos, su origen y sus acciones");

        // E. Administrar desde Eventos: acción real «Cerrar aquí» en un grupo.
        await page.evaluate(() => {
            const art = [...document.querySelectorAll("article")].find(a => a.querySelector("h3")?.textContent.trim() === "Chontico Noche");
            [...art.querySelectorAll("button")].find(b => b.textContent.trim() === "Administrar sorteo").click();
        });
        await esperarTexto(page, "Cerrar en todos");
        texto = await textoPagina(page);
        for (const b of ["Cerrar aquí", "Desactivar aquí", "Editar", "Desactivar en todos", "Cancelar sorteo", "Eliminar"]) assert.ok(texto.includes(b), b);
        await pulsar(page, "Cerrar aquí");
        await esperarTexto(page, "Deja de aceptar reservas");
        await pulsar(page, "Confirmar");
        await esperarTexto(page, "Cerrar sorteo: hecho en 1 grupo(s).");
        const filasChontico = t.eventos_bot.filter(e => e.identidad_evento_real === `chontico-noche-${MANANA}`);
        assert.deepStrictEqual(filasChontico.map(e => e.activo), [false, true], "cerrado solo en un grupo");
        paso("«Administrar sorteo» en Eventos: acciones de siempre; «Cerrar aquí» cierra SOLO ese grupo (backend real)");

        // F. Enlace antiguo /sorteos?vista=administrar&sorteo=<evento>.
        const eventoProg = gruposProg[1].evento_bot_id;
        await page.goto(`${PANEL}/sorteos?vista=administrar&sorteo=${eventoProg}`, { waitUntil: "domcontentloaded" });
        await page.waitForFunction(() => location.pathname === "/eventos", { timeout: 60000 });
        await esperarTexto(page, "Cerrar en todos");
        const titulo = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] h3')].map(h => h.textContent.trim()));
        assert.deepStrictEqual(titulo, ["Lotería E2E Programada"]);
        assert.ok((await textoPagina(page)).includes("Programado"), "con su origen");
        paso("enlace antiguo ?vista=administrar&sorteo= → Eventos con ESE sorteo abierto");

        // G. Calendario de loterías sigue abriendo.
        await page.goto(`${PANEL}/loterias`, { waitUntil: "domcontentloaded" });
        await esperarTexto(page, "Calendario de loterías");
        paso("Calendario de loterías sigue disponible");

        // H. Móvil sin desborde en Eventos.
        await page.setViewport({ width: 390, height: 844 });
        await page.goto(`${PANEL}/eventos`, { waitUntil: "domcontentloaded" });
        await esperarTexto(page, "Chontico Noche");
        const desborde = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        assert.ok(desborde <= 1, `desborde horizontal de ${desborde}px`);
        await captura(page, "centro_eventos_movil");
        paso("Eventos en móvil (390 px): sin desborde horizontal");

        assert.deepStrictEqual(errores, [], "sin errores de JavaScript en la página");
        paso("sin errores de JavaScript");

    } finally {
        await entorno.cerrar();
    }

}

terminar(main());
