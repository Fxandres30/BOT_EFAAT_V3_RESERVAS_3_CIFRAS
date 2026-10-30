// ==========================================================================
// PRUEBA DE EXTREMO A EXTREMO — «Sorteo instantáneo» con un navegador real
// (Chrome vía puppeteer), el panel Next real (next dev) y la API real del
// backend (routes/sorteos.js -> servicio.publicarAhora -> publicador.tick ->
// guardarEvento, abrirGrupo, compartirEnGrupos con su ExecutionGuard).
//
// ENTORNO AISLADO (tests/e2e/entornoPanel.js): Supabase en memoria y un
// socket de WhatsApp SIMULADO que registra lo que se enviaría. La captura
// de la tabla devuelve un PNG fijo (la captura real está en
// capturaRealSorteo.test.js). No toca Supabase ni WhatsApp reales.
//
//     node backend/tests/e2e/sorteoInstantaneo.e2e.js
//
// No se incluye en la regresión (`*.test.js`): necesita compilar el panel.
// ==========================================================================

process.env.GROUP_QUEUE_DELAY_MS = "0";

const assert = require("assert");
const path = require("path");

const {
    PANEL, tablas: t, peticionesSupabase, registrarUsuario, arrancarEntorno,
    rellenar, rellenarAria, marcar, pulsar, botonHabilitado, esperarTexto, textoPagina, captura, crearPasos
} = require("./entornoPanel");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);

// Mismo require.cache que entornoPanel (Supabase falso ya inyectado).
const servicio = require(r("sorteos/servicio.js"));
const destinos = require(r("services/destinosCompartir.js"));
const { compartirEnGrupos } = require(r("services/compartirTabla.js"));
const { ejecutarUnaVez } = require(r("automation/executionGuard.js"));
const { guardarEvento } = require(r("bot/funciones/eventos/guardarEvento.js"));
const { consultarEventoDelSorteo } = require(r("bot/funciones/eventos/consultarEvento.js"));
const { abrirGrupo } = require(r("bot/funciones/eventos/grupos/abrirGrupo.js"));
const { actualizarEvento } = require(r("bot/funciones/reservas/actualizarEvento.js"));

const TOKEN_USUARIO = "e2e-token-instantaneo";
const A = "aaaaaaaa-0000-4000-8000-00000000000a";
registrarUsuario(TOKEN_USUARIO, A, "e2e@prueba.local");

t.grupos_autorizados = [
    { usuario_id: A, grupo_id: "g1@g.us", activo: true },
    { usuario_id: A, grupo_id: "g2@g.us", activo: true }
];
t.grupos = [{ jid: "g1@g.us", nombre: "Grupo Prueba Uno" }, { jid: "g2@g.us", nombre: "Grupo Prueba Dos" }];
t.cuentas_pago = [{ id: "cuenta-e2e", usuario_id: A, nombre: "Nequi Prueba", tipo: "nequi", numero: "3000000001", titular: "Prueba", activa: true }];
t.eventos_bot = [];
// $5.000 (la del sorteo) libre; en $2.000, pagos de otro sorteo que no se tocan.
for (const tabla of ["reservas_dos_cifras", "5k_15k_reservas_2_cifras"]) {
    const conPagos = tabla === "reservas_dos_cifras";
    t[tabla] = Array.from({ length: 100 }, (_, i) => ({ numero: String(i).padStart(2, "0"), estado: conPagos && i < 2 ? "pagado" : "libre", usuario_id: A, ...(conPagos && i < 2 ? { identidad_evento_real: "otro-sorteo" } : {}) }));
}

// PNG real de 1x1: lo que mostraría la vista previa y lo que se envía.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

// WhatsApp simulado: registra cada envío y cada cambio de grupo.
const enviados = [];
const operaciones = [];
const sock = {
    context: { usuarioId: A, sessionId: "ses-e2e", telefono: "573000000000" },
    user: { id: "573000000000:1@s.whatsapp.net" },
    groupMetadata: async (jid) => ({ subject: `Nombre ${jid}`, participants: [{}, {}] }),
    groupSettingUpdate: async (jid, ajuste) => { operaciones.push({ jid, ajuste }); },
    sendMessage: async (jid, contenido) => {
        enviados.push({ jid, tipo: contenido.image ? "imagen" : "texto", image: contenido.image, texto: contenido.caption ?? contenido.text });
        return { key: { id: `msg-${enviados.length}` } };
    }
};
let capturasServidor = 0;
servicio.instantaneo._socketDe = (u) => (u === A ? sock : null);
servicio.instantaneo._deps = {
    supabase: require(r("lib/supabase.js")),
    guardarEvento, consultarEventoDelSorteo, abrirGrupo, ejecutarUnaVez, actualizarEvento,
    puedeActuar: () => true,
    capturarImagen: async () => { capturasServidor++; return PNG; },
    textoParaCompartir: destinos.textoParaCompartir,
    compartirEnGrupos,
    sendMessage: async () => { throw new Error("el anuncio nunca sale como texto"); }
};

const { paso, terminar } = crearPasos();

async function main() {

    const entorno = await arrancarEntorno();

    try {

        const page = await entorno.nuevaPagina(TOKEN_USUARIO);
        const erroresConsola = page.erroresJs;
        await page.setViewport({ width: 1366, height: 900 });

        // 1. Menú: acceso directo «Publicar ahora» justo debajo de «Programados».
        await page.goto(`${PANEL}/sorteo-instantaneo`, { waitUntil: "domcontentloaded" });
        await esperarTexto(page, "Publicar sorteo ahora");
        const menu = await page.evaluate(() => [...document.querySelectorAll("nav a")].map(a => a.textContent.trim()));
        const i = menu.indexOf("Programados");
        assert.ok(i >= 0 && menu[i + 1] === "Publicar ahora", JSON.stringify(menu));
        await esperarTexto(page, "Todavía no has publicado sorteos instantáneos");
        await captura(page, "instantaneo_inicio");
        paso("menú: «Publicar ahora» debajo de «Programados»; página con su explicación y lista vacía");

        // 2. Formulario en modo inmediato: sin hora de publicación.
        await pulsar(page, "Publicar sorteo ahora");
        await esperarTexto(page, "Grupo Prueba Uno");
        await esperarTexto(page, "Nequi Prueba");
        const form = await textoPagina(page);
        assert.ok(!form.includes("Fecha y hora de publicación"), "sin hora de publicación");
        await rellenar(page, "Lotería o nombre del sorteo", "Lotería E2E Instantánea");
        await rellenar(page, "Hora del sorteo", "23:50");
        await rellenar(page, "Valor por número", "5000");
        await rellenarAria(page, "Premio", "Premio mayor");
        await rellenarAria(page, "Valor del premio", "300000");
        await marcar(page, "Grupo Prueba Uno");
        await marcar(page, "Nequi Prueba");
        await captura(page, "instantaneo_formulario");
        await pulsar(page, "Guardar y ver vista previa");
        assert.strictEqual(enviados.length, 0, "guardar no publica");
        paso("formulario en modo inmediato (sin hora de publicación); guardar no publica nada");

        // 3. Vista previa: imagen generada por el servidor ANTES de publicar.
        await esperarTexto(page, "Imagen que se enviará (generada por el servidor)");
        await page.waitForFunction(() => {
            const img = document.querySelector('img[alt="Imagen de la tabla que se enviará por WhatsApp"]');
            return img && img.complete && img.naturalWidth > 0;
        }, { timeout: 60000 });
        const vista = await textoPagina(page);
        assert.ok(vista.includes("Listo para publicar ahora") && vista.includes("en el momento en que pulses «Publicar ahora»"), vista);
        assert.ok(capturasServidor >= 1, "la imagen la generó el servidor");
        assert.strictEqual(await botonHabilitado(page, "Publicar ahora"), false, "sin marcar la revisión no se publica");
        assert.strictEqual(await botonHabilitado(page, "Confirmar y programar"), null, "no hay botón de programar");
        await captura(page, "instantaneo_vista_previa");
        paso("vista previa: imagen real del servidor visible; «Publicar ahora» bloqueado hasta revisar");

        // 4. Publicar con DOBLE CLIC: una sola publicación.
        await marcar(page, "Revisé la fecha");
        await page.waitForFunction(() => [...document.querySelectorAll("button")].some(b => b.textContent.trim() === "Publicar ahora" && !b.disabled));
        await page.evaluate(() => {
            const b = [...document.querySelectorAll("button")].find(x => x.textContent.trim() === "Publicar ahora");
            b.click(); b.click();
        });
        await esperarTexto(page, "Enviado en 1 de 1 grupo(s).");
        await captura(page, "instantaneo_resultado");
        assert.strictEqual(enviados.length, 1, "un solo mensaje");
        assert.strictEqual(enviados[0].jid, "g1@g.us");
        assert.strictEqual(enviados[0].tipo, "imagen");
        assert.ok(Buffer.from(enviados[0].image).equals(PNG), "la foto adjunta");
        assert.ok(enviados[0].texto.includes("Lotería E2E Instantánea") && enviados[0].texto.includes("Nequi Prueba"), enviados[0].texto);
        const s = t.sorteos_programados[0];
        assert.strictEqual(t.sorteos_programados.length, 1);
        assert.strictEqual(s.estado, "publicado");
        const eventos = t.eventos_bot.filter(e => e.identidad_evento_real === s.identidad_evento_real);
        assert.strictEqual(eventos.length, 1);
        assert.ok(eventos[0].activo && eventos[0].grupo_id === "g1@g.us");
        assert.ok(operaciones.some(o => o.jid === "g1@g.us" && o.ajuste === "not_announcement"), "grupo abierto");
        assert.deepStrictEqual(t.reservas_dos_cifras.filter(f => f.estado === "pagado").map(f => [f.numero, f.identidad_evento_real]), [["00", "otro-sorteo"], ["01", "otro-sorteo"]], "pagos existentes intactos");
        assert.ok(t["5k_15k_reservas_2_cifras"].every(f => f.estado === "libre"), "publicar no cambia ningún número");
        paso("«Publicar ahora» (doble clic): 1 sorteo, 1 evento activo en el grupo, 1 mensaje con la foto y el anuncio; pagos intactos");

        // 5. La lista muestra el resultado real.
        await pulsar(page, "Cerrar");
        await esperarTexto(page, "Lotería E2E Instantánea");
        await esperarTexto(page, "Publicado");
        paso("la lista de la sección muestra el sorteo publicado y el estado de su grupo");

        // 6. Móvil: sin desbordes horizontales.
        await page.setViewport({ width: 390, height: 844 });
        await page.reload({ waitUntil: "domcontentloaded" });
        await esperarTexto(page, "Lotería E2E Instantánea");
        const desborde = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        assert.ok(desborde <= 1, `desborde horizontal de ${desborde}px`);
        await captura(page, "instantaneo_movil");
        paso("móvil (390 px): sin desborde horizontal");

        assert.ok(peticionesSupabase.every(p => !/sorteos_programados|eventos_bot/.test(p)), "el panel no escribe en la base directamente");
        assert.deepStrictEqual(erroresConsola, [], "sin errores de JavaScript en la página");
        paso("aislado: el panel solo usa la API /sorteos; sin errores de JS");

    } finally {
        await entorno.cerrar();
    }

}

terminar(main());
