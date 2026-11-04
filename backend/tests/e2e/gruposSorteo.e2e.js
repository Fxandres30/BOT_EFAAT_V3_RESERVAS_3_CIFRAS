// ==========================================================================
// PRUEBA DE EXTREMO A EXTREMO — Grupos de un sorteo del panel (04/11/2026),
// con navegador real (Chrome vía puppeteer), panel Next real y API real
// (routes/tablas.js y routes/sorteos.js):
//
//   1. Tablas → «Cambiar grupos»: el sorteo está activo en Grupo Uno y Dos;
//      se agrega Grupo Tres y «Guardar grupos sin enviar» lo asocia (BD) sin
//      enviar nada.
//   2. «Continuar» → «Confirmar y enviar»: SOLO Grupo Tres recibe el sorteo
//      (evento activo con la misma identidad y tabla, grupo abierto, anuncio)
//      y queda operativo para reservas; Uno y Dos no reciben nada.
//   3. «Editar»: se agrega Grupo Cuatro y se quita Grupo Dos → guardar no
//      envía nada; Grupo Dos queda desactivado (reservas intactas);
//      «Publicar en los grupos nuevos» activa el sorteo solo en Grupo Cuatro.
//   4. Sorteo DETECTADO en WhatsApp ($2.000, Grupo Dos): «Editar» →
//      «Gestionar desde el panel» (cuentas) → agregar Grupo Cinco → publicar:
//      Grupo Cinco recibe el MISMO sorteo (identidad y tabla); Dos, nada.
//
// ENTORNO AISLADO (tests/e2e/entornoPanel.js): Supabase en memoria, WhatsApp
// SIMULADO. No toca datos reales ni envía nada.
//
//     node backend/tests/e2e/gruposSorteo.e2e.js
// ==========================================================================

process.env.GROUP_QUEUE_DELAY_MS = "0";
delete process.env.TABLA_SHARE_SECRET;
process.env.FRONTEND_URL = "http://127.0.0.1:3100";

const assert = require("assert");
const path = require("path");

const {
    PANEL, tablas: t, registrarUsuario, arrancarEntorno, servirTablas,
    pulsar, marcar, esperarTexto, textoPagina, fechaColombia, captura, crearPasos
} = require("./entornoPanel");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);
function inyectar(rutaRel, exportsObj) {
    const abs = r(rutaRel);
    require.cache[abs] = { id: abs, filename: abs, loaded: true, exports: exportsObj };
}

const TOKEN = "e2e-token-grupos-sorteo";
const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const T5K = "5k_15k_reservas_2_cifras";
registrarUsuario(TOKEN, A, "grupos@prueba.local");

// WhatsApp simulado: todo lo que saldría a un grupo.
const salidas = [];
inyectar("services/baileys/send.js", {
    sendImage: async ({ jid, caption }) => { salidas.push({ jid, tipo: "imagen", texto: caption }); return { key: { id: `m${salidas.length}` } }; },
    sendMessage: async ({ jid, text }) => { salidas.push({ jid, tipo: "texto", texto: text }); return { key: { id: `m${salidas.length}` } }; }
});
const operaciones = [];
const sock = {
    context: { usuarioId: A, sessionId: "ses-e2e-grupos", telefono: "573000000000" },
    user: { id: "573000000000:1@s.whatsapp.net" },
    groupMetadata: async (jid) => ({ subject: `Nombre ${jid}`, participants: [{}, {}] }),
    groupSettingUpdate: async (jid, ajuste) => { operaciones.push({ jid, ajuste }); },
    sendMessage: async () => ({ key: { id: "x" } })
};
inyectar("services/baileys/manager.js", { getSocketActivoDe: (u) => (u === A ? sock : null) });

const NOMBRES = { "g1@g.us": "Grupo Prueba Uno", "g2@g.us": "Grupo Prueba Dos", "g3@g.us": "Grupo Prueba Tres", "g4@g.us": "Grupo Prueba Cuatro", "g5@g.us": "Grupo Prueba Cinco" };
const T2K = "reservas_dos_cifras";
t.grupos_autorizados = Object.keys(NOMBRES).map(g => ({ usuario_id: A, grupo_id: g, activo: true }));
t.grupos = Object.entries(NOMBRES).map(([jid, nombre]) => ({ jid, nombre }));
t.cuentas_pago = [{ id: "cuenta-e2e", usuario_id: A, nombre: "Nequi Prueba", tipo: "nequi", numero: "3000000001", titular: "Prueba", activa: true }];
t.eventos_bot = [];
t.reservas_archivo = [];
t[T5K] = Array.from({ length: 100 }, (_, i) => ({ id: `n-${i}`, numero: String(i).padStart(2, "0"), estado: "libre", usuario_id: A }));
t[T2K] = Array.from({ length: 100 }, (_, i) => ({ id: `d-${i}`, numero: String(i).padStart(2, "0"), estado: "libre", usuario_id: A }));

const servicio = require(r("sorteos/servicio.js"));
const publicador = require(r("sorteos/publicador.js"));
const gruposSorteo = require(r("sorteos/gruposSorteo.js"));
const { consultarEvento } = require(r("bot/funciones/eventos/consultarEvento.js"));
const { reservarNumerosDetallado } = require(r("bot/funciones/reservas/reservarNumeros.js"));

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const deps = { ...publicador.dependenciasReales(), puedeActuar: () => true, capturarImagen: async () => PNG };
servicio.instantaneo._socketDe = (u) => (u === A ? sock : null);
servicio.instantaneo._deps = deps;
gruposSorteo.deps.puedeActuar = () => true;
gruposSorteo.deps.publicadorDeps = deps;

const { paso, terminar } = crearPasos();

const salidasA = (g) => salidas.filter(x => x.jid === g);
const eventosDe = (s) => t.eventos_bot.filter(e => e.identidad_evento_real === s.identidad_evento_real);
const eventoEn = (s, g) => eventosDe(s).find(e => e.grupo_id === g);
const filaGrupo = (g) => t.sorteos_programados_grupos.find(x => x.grupo_id === g);
const tomados = () => JSON.stringify(t[T5K].filter(f => f.estado !== "libre").map(f => [f.numero, f.estado, f.identidad_evento_real]));

async function main() {

    // Sorteo del panel publicado AHORA en Grupo Uno y Dos (mismo flujo que
    // «Publicar ahora»), con una reserva en cada grupo.
    const c = await servicio.crearSorteo(A, {
        modalidad: "dos_cifras", nombre: "Sorteo A E2E", hora_fin: "22:30", valor: 5000,
        premios: [{ nombre: "Premio mayor", premio: 300000 }], grupos: ["g1@g.us", "g2@g.us"], cuentas: ["cuenta-e2e"],
        publicacion_inmediata: true, fecha_sorteo: fechaColombia(1), mensajes: { publicacion: "", aviso_cierre: "" }, recordatorios: []
    });
    assert.ok(c.ok, JSON.stringify(c));
    const pub = await servicio.publicarAhora(A, c.data.id, { version: c.data.version, confirmacion: true });
    assert.ok(pub.ok && pub.data.publicados === 2, JSON.stringify(pub));
    const s = t.sorteos_programados[0];
    for (const [g, n] of [["g1@g.us", "05"], ["g2@g.us", "06"]]) {
        const ev = await consultarEvento(g, A);
        const res = await reservarNumerosDetallado({ evento: ev, numeros: [n], usuario: { telefono: "573111111111" }, comprador: "Ana", contacto: "573111111111" });
        assert.strictEqual(res.filas.length, 1);
    }
    const reservasIniciales = tomados();

    servirTablas([T5K, T2K, "eventos_bot", "reservas_actividad", "tablas_cliente", "tabla_configuracion_visual", "tabla_disenos"]);
    const entorno = await arrancarEntorno({ montarBackend: (app, express) => {
        app.use("/tablas/compartir", express.json({ limit: "6mb" }));
        app.use("/tablas", require(r("routes/tablas.js")));
    } });

    try {

        const page = await entorno.nuevaPagina(TOKEN);
        await page.setViewport({ width: 1366, height: 900 });

        // 1. «Cambiar grupos»: agregar Grupo Tres y guardar (sin enviar).
        await page.goto(`${PANEL}/tablas/5000`, { waitUntil: "domcontentloaded" });
        await pulsar(page, "Cambiar grupos");
        await esperarTexto(page, "Grupo Prueba Tres");
        await esperarTexto(page, "Sorteo activo");
        await marcar(page, "Grupo Prueba Tres");
        await esperarTexto(page, "Nuevo: recibirá este sorteo");
        await captura(page, "grupos_tablas_seleccion");
        const antes1 = salidas.length;
        await pulsar(page, "Guardar grupos sin enviar");
        await esperarTexto(page, "Agregados: Grupo Prueba Tres");
        assert.strictEqual(filaGrupo("g3@g.us")?.estado, "pendiente", "asociación guardada en la base");
        assert.strictEqual(salidas.length, antes1, "guardar no envía nada");
        assert.strictEqual(eventoEn(s, "g3@g.us"), undefined);
        paso("«Cambiar grupos» → Guardar: Grupo Tres queda asociado al sorteo en la base (pendiente), sin enviar nada");

        // 2. Publicar: solo Grupo Tres recibe y activa el sorteo.
        const g12 = [salidasA("g1@g.us").length, salidasA("g2@g.us").length];
        await pulsar(page, "Continuar");
        await esperarTexto(page, "Recibirán ESTE sorteo");
        const confirmacion = await textoPagina(page);
        assert.ok(/Compartir también la tabla actualizada en los grupos que ya tienen el sorteo \(Grupo Prueba Uno, Grupo Prueba Dos\)/.test(confirmacion), confirmacion);
        await captura(page, "grupos_tablas_confirmar");
        await pulsar(page, "Confirmar y enviar");
        await esperarTexto(page, "Sorteo activado en el grupo y anuncio enviado");
        await captura(page, "grupos_tablas_resultado");
        const e3 = eventoEn(s, "g3@g.us");
        assert.ok(e3 && e3.activo && e3.abierto && e3.tabla === T5K, JSON.stringify(e3));
        assert.strictEqual(filaGrupo("g3@g.us").estado, "publicado");
        assert.ok(operaciones.some(o => o.jid === "g3@g.us" && o.ajuste === "not_announcement"), "Grupo Tres abierto");
        assert.strictEqual(salidasA("g3@g.us").filter(x => x.tipo === "imagen").length, 1, "un anuncio con la imagen");
        assert.deepStrictEqual([salidasA("g1@g.us").length, salidasA("g2@g.us").length], g12, "Uno y Dos no reciben nada");
        const ev3 = await consultarEvento("g3@g.us", A);
        const res3 = await reservarNumerosDetallado({ evento: ev3, numeros: ["30"], usuario: { telefono: "573222222222" }, comprador: "Beto", contacto: "573222222222" });
        assert.strictEqual(res3.filas.length, 1, "Grupo Tres operativo: acepta la reserva");
        const res05 = await reservarNumerosDetallado({ evento: ev3, numeros: ["05"], usuario: { telefono: "573222222222" }, comprador: "Beto", contacto: "573222222222" });
        assert.strictEqual(res05.filas.length, 0, "misma tabla: el 05 del Grupo Uno está ocupado");
        paso("Confirmar: SOLO Grupo Tres recibe el anuncio y activa el MISMO sorteo (identidad y tabla); acepta reservas y comparte la tabla; Uno y Dos sin mensajes");

        // 3. «Editar»: agregar Grupo Cuatro y quitar Grupo Dos.
        await pulsar(page, "Cerrar");
        const reservasAntesEditar = tomados();
        await pulsar(page, "Editar");
        await esperarTexto(page, "Editar sorteo activo");
        await esperarTexto(page, "Grupo Prueba Cuatro");
        await marcar(page, "Grupo Prueba Cuatro");
        await marcar(page, "Grupo Prueba Dos");
        await esperarTexto(page, "Al guardar, el sorteo se DESACTIVA en Grupo Prueba Dos");
        await captura(page, "grupos_editar");
        const antes3 = salidas.length;
        await pulsar(page, "Guardar cambios");
        await esperarTexto(page, "Cambios guardados. Guardar no envió nada a WhatsApp.");
        assert.strictEqual(salidas.length, antes3, "guardar la edición no envía nada");
        assert.strictEqual(eventoEn(s, "g2@g.us").activo, false, "Grupo Dos desactivado");
        assert.strictEqual(filaGrupo("g4@g.us").estado, "pendiente");
        assert.strictEqual(tomados(), reservasAntesEditar, "reservas intactas (también la del Grupo Dos)");
        const g13 = [salidasA("g1@g.us").length, salidasA("g3@g.us").length];
        await pulsar(page, "Publicar en los grupos nuevos");
        await page.waitForFunction(() => /Grupo Prueba Cuatro/.test(document.querySelector('[aria-label="Publicación en los grupos nuevos"]')?.innerText || ""), { timeout: 120000 });
        await captura(page, "grupos_editar_publicado");
        const e4 = eventoEn(s, "g4@g.us");
        assert.ok(e4 && e4.activo && e4.tabla === T5K && e4.identidad_evento_real === s.identidad_evento_real, JSON.stringify(e4));
        assert.deepStrictEqual([salidasA("g1@g.us").length, salidasA("g3@g.us").length], g13, "Uno y Tres no reciben nada");
        assert.strictEqual(salidasA("g2@g.us").length, g12[1], "Grupo Dos (quitado) no recibe nada");
        assert.ok(reservasIniciales.length > 2 && JSON.parse(tomados()).length === JSON.parse(reservasIniciales).length + 1, "solo la reserva nueva del Grupo Tres");
        assert.strictEqual(t.sorteos_programados.length, 1, "un solo sorteo");
        assert.deepStrictEqual(eventosDe(s).map(e => e.grupo_id).sort(), ["g1@g.us", "g2@g.us", "g3@g.us", "g4@g.us"], "una fila por grupo");
        assert.strictEqual(t[T5K].length, 100, "la tabla no se regeneró");
        paso("«Editar»: agrega Grupo Cuatro y quita Grupo Dos sin enviar nada; «Publicar en los grupos nuevos» activa solo Grupo Cuatro; Dos desactivado con reservas intactas");

        // 4. Sorteo DETECTADO en WhatsApp en Grupo Dos ($2.000), con una reserva.
        t.eventos_bot.push({
            id: "e0000000-0000-4000-8000-0000000d2000", usuario_id: A, grupo_id: "g2@g.us", grupo_nombre: "Grupo Prueba Dos",
            activo: true, abierto: true, estado: "abierto", identidad_evento_real: "det-2000",
            nombre_evento: "Chontico Noche", hora_fin: "22:30", hora_cierre: "22:26", fecha_evento: fechaColombia(1),
            valor: 2000, premios: [{ tipo: "otro", nombre: "Mayor", premio: 100000 }], tabla: T2K, cifras: 2, cantidad_numeros: 100,
            creado_en: new Date(Date.now() - 60 * 60 * 1000).toISOString()
        });
        Object.assign(t[T2K].find(f => f.numero === "12"), { estado: "reservado", identidad_evento_real: "det-2000", grupo_id: "g2@g.us", comprador: "Ana" });
        const reservasDetectado = JSON.stringify(t[T2K].filter(f => f.estado !== "libre"));
        const antesG2 = salidasA("g2@g.us").length;
        await page.goto(`${PANEL}/tablas/2000`, { waitUntil: "domcontentloaded" });
        await pulsar(page, "Editar");
        await esperarTexto(page, "Agregar este sorteo a otros grupos");
        await pulsar(page, "Gestionar desde el panel");
        await esperarTexto(page, "Nequi Prueba");
        await pulsar(page, "Confirmar: gestionar desde el panel");
        await esperarTexto(page, "Guardar no publica nada");
        // Los grupos disponibles se piden aparte: se espera a que estén.
        await esperarTexto(page, "Grupo Prueba Cinco");
        const prog = t.sorteos_programados.find(x => x.identidad_evento_real === "det-2000");
        assert.ok(prog && prog.config.origen === "whatsapp" && prog.tabla === T2K, JSON.stringify(prog));
        assert.strictEqual(salidasA("g2@g.us").length, antesG2, "pasarlo al panel no envía nada");
        await marcar(page, "Grupo Prueba Cinco");
        await captura(page, "grupos_detectado_editar");
        await pulsar(page, "Guardar cambios");
        await esperarTexto(page, "Cambios guardados. Guardar no envió nada a WhatsApp.");
        await pulsar(page, "Publicar en los grupos nuevos");
        await page.waitForFunction(() => /Grupo Prueba Cinco/.test(document.querySelector('[aria-label="Publicación en los grupos nuevos"]')?.innerText || ""), { timeout: 120000 });
        await captura(page, "grupos_detectado_publicado");
        const e5 = t.eventos_bot.find(e => e.grupo_id === "g5@g.us" && e.identidad_evento_real === "det-2000");
        assert.ok(e5 && e5.activo && e5.tabla === T2K, JSON.stringify(e5));
        assert.strictEqual(salidasA("g5@g.us").filter(x => x.tipo === "imagen").length, 1, "Grupo Cinco: un anuncio con la imagen");
        assert.ok(/Nequi Prueba/.test(salidasA("g5@g.us").find(x => x.tipo === "imagen").texto), "el anuncio lleva la cuenta elegida");
        assert.strictEqual(salidasA("g2@g.us").length, antesG2, "Grupo Dos (original) no recibe nada");
        assert.strictEqual(JSON.stringify(t[T2K].filter(f => f.estado !== "libre")), reservasDetectado, "reservas del detectado intactas");
        assert.strictEqual(t.sorteos_programados.filter(x => x.identidad_evento_real === "det-2000").length, 1, "una sola programación");
        assert.strictEqual(t.eventos_bot.filter(e => e.identidad_evento_real === "det-2000").length, 2, "una fila por grupo (Dos y Cinco)");
        paso("Detectado en WhatsApp: «Gestionar desde el panel» y agregar Grupo Cinco → recibe el MISMO sorteo y tabla con la cuenta elegida; Grupo Dos sin mensajes; reservas intactas");

        assert.deepStrictEqual(page.erroresJs, [], "sin errores de JavaScript en la página");
        paso("sin errores de JavaScript en la página");

    } finally {
        await entorno.cerrar();
    }

}

terminar(main());
