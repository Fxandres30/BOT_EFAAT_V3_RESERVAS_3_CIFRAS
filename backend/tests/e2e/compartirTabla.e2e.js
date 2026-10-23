// ==========================================================================
// PRUEBA DE EXTREMO A EXTREMO — Tablas $5.000 → «Compartir» con grupos de
// destino, con navegador real (Chrome vía puppeteer), panel Next real, API
// real (routes/tablas.js) y captura REAL de la imagen de la tabla
// (services/compartirTabla.js → /tablas/imprimir/5000 del panel).
//
//   1. Primer «Compartir»: sin grupos guardados abre la vista previa (imagen
//      real + texto debajo) y la lista de grupos; nada se envía al cargar.
//   2. Elegir grupos → confirmar (lista de destinos) → envío: imagen PNG +
//      caption en el mismo mensaje a cada grupo; resultado por grupo.
//   3. Segundo «Compartir»: directo a los grupos guardados, sin volver a
//      elegir.
//   4. «Cambiar grupos» muestra la selección guardada.
//
// ENTORNO AISLADO (tests/e2e/entornoPanel.js): no toca Supabase. WhatsApp es
// SIMULADO (se registran los envíos): esta prueba NO envía nada real.
//
//     node backend/tests/e2e/compartirTabla.e2e.js
// ==========================================================================

const assert = require("assert");
const path = require("path");

process.env.TABLA_SHARE_SECRET = "secreto-e2e";
process.env.FRONTEND_URL = "http://127.0.0.1:3100";

const {
    PANEL, tablas: t, registrarUsuario, arrancarEntorno, servirTablas,
    pulsar, esperarTexto, textoPagina, fechaColombia, crearPasos
} = require("./entornoPanel");

const RAIZ = path.resolve(__dirname, "../..");
function inyectar(rutaRel, exportsObj) {
    const abs = path.join(RAIZ, rutaRel);
    require.cache[abs] = { id: abs, filename: abs, loaded: true, exports: exportsObj };
}

const TOKEN = "e2e-token-compartir";
const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const T5K = "5k_15k_reservas_2_cifras";

registrarUsuario(TOKEN, A, "compartir@prueba.local");

// WhatsApp simulado (el socket de A); nada sale de esta máquina.
const envios = [];
inyectar("services/baileys/send.js", {
    sendImage: async ({ jid, image, caption }) => { envios.push({ jid, image, caption }); },
    sendMessage: async () => { throw new Error("no debe enviarse texto suelto"); }
});
inyectar("services/baileys/manager.js", { getSocketActivoDe: (u) => (u === A ? { usuario: A } : null) });

t.grupos_autorizados = [
    { usuario_id: A, grupo_id: "g1@g.us", activo: true },
    { usuario_id: A, grupo_id: "g2@g.us", activo: true },
    { usuario_id: B, grupo_id: "gb@g.us", activo: true }
];
t.grupos = [{ jid: "g1@g.us", nombre: "Rifa uno" }, { jid: "g2@g.us", nombre: "Rifa dos" }, { jid: "gb@g.us", nombre: "Grupo de B" }];
t.eventos_bot = [{
    id: "e0000000-0000-4000-8000-000000000001", usuario_id: A, grupo_id: "g1@g.us", grupo_nombre: "Rifa uno",
    activo: true, abierto: true, estado: "abierto", identidad_evento_real: "det-a",
    nombre_evento: "Chontico Noche", hora_fin: "22:30", hora_cierre: "22:26", fecha_evento: fechaColombia(1),
    valor: 5000, premios: [{ tipo: "otro", nombre: "Mayor", premio: 100000 }], tabla: T5K, cifras: 2, cantidad_numeros: 100,
    creado_en: "2026-10-22T12:00:00Z"
}];
t[T5K] = [A, B].flatMap(u => Array.from({ length: 100 }, (_, i) => ({ id: `${u}-${i}`, numero: String(i).padStart(2, "0"), estado: i < 2 ? "pagado" : "libre", usuario_id: u })));

const { paso, terminar } = crearPasos();
const PNG = "89504e470d0a1a0a";

async function main() {

    servirTablas([T5K, "eventos_bot", "reservas_actividad", "tablas_cliente", "tabla_configuracion_visual", "tabla_disenos"]);

    const entorno = await arrancarEntorno({ montarBackend: (app) => app.use("/tablas", require(path.join(RAIZ, "routes/tablas.js"))) });

    try {

        const page = await entorno.nuevaPagina(TOKEN);
        const reservasAntes = JSON.stringify(t[T5K]);

        // 1. Primer clic: configuración con vista previa real.
        await page.goto(`${PANEL}/tablas/5000`, { waitUntil: "domcontentloaded" });
        await pulsar(page, "Compartir");
        await esperarTexto(page, "Compartir tabla en WhatsApp");
        await esperarTexto(page, "Elige los grupos donde se publicará esta tabla.");
        await page.waitForSelector('[aria-label="Vista previa del mensaje"] img', { timeout: 120000 });
        const src = await page.$eval('[aria-label="Vista previa del mensaje"] img', i => i.getAttribute("src"));
        assert.ok(src.startsWith("data:image/png;base64,") && Buffer.from(src.split(",")[1], "base64").toString("hex").startsWith(PNG), "PNG real");
        const caption = await page.$eval('[aria-label="Vista previa del mensaje"] textarea', e => e.value);
        assert.ok(caption.includes("Chontico Noche"), caption);
        const texto = await textoPagina(page);
        assert.ok(texto.includes("Rifa uno") && texto.includes("Rifa dos") && !texto.includes("Grupo de B"), "solo los grupos de A");
        assert.strictEqual(envios.length, 0, "abrir la vista previa no envía");
        paso("primer «Compartir»: vista previa con la imagen REAL de la tabla, el texto debajo y los grupos del cliente; nada enviado");

        // 2. Elegir, confirmar y enviar.
        await page.evaluate(() => [...document.querySelectorAll("label")].filter(l => /Rifa (uno|dos)/.test(l.textContent)).forEach(l => l.querySelector("input").click()));
        await pulsar(page, "Continuar");
        await esperarTexto(page, "Se publicará la imagen con este texto en:");
        assert.strictEqual(envios.length, 0, "sin confirmar no se envía");
        await pulsar(page, "Confirmar y enviar");
        await esperarTexto(page, "Publicada en 2 grupo(s).");
        assert.deepStrictEqual(envios.map(e => e.jid), ["g1@g.us", "g2@g.us"]);
        assert.ok(envios.every(e => e.image.toString("hex").startsWith(PNG) && e.caption === caption), "imagen + caption en el mismo mensaje");
        assert.deepStrictEqual(t.destinos_compartir_tabla.map(d => [d.usuario_id, d.precio, d.grupos]), [[A, 5000, ["g1@g.us", "g2@g.us"]]]);
        paso("confirmación con los destinos → imagen PNG + caption a cada grupo; resultado por grupo; selección guardada");

        // 3. Siguiente clic: directo, sin volver a elegir.
        await pulsar(page, "Cerrar");
        await pulsar(page, "Compartir");
        await page.waitForFunction(() => document.body.innerText.split("Publicada en 2 grupo(s).").length > 1, { timeout: 120000 });
        assert.ok(!(await textoPagina(page)).includes("Compartir tabla en WhatsApp"), "no vuelve a pedir los grupos");
        assert.strictEqual(envios.length, 4);
        paso("segundo «Compartir»: publica directamente en los grupos guardados");

        // 4. Cambiar grupos: muestra la selección guardada.
        await pulsar(page, "Cambiar grupos");
        await page.waitForSelector('[aria-label="Grupos de destino"] input', { timeout: 120000 });
        const marcados = await page.evaluate(() => [...document.querySelectorAll('[aria-label="Grupos de destino"] label')].filter(l => l.querySelector("input").checked).map(l => l.textContent.trim()));
        assert.deepStrictEqual(marcados, ["Rifa uno", "Rifa dos"]);
        assert.strictEqual(envios.length, 4, "abrir «Cambiar grupos» no envía");
        assert.strictEqual(JSON.stringify(t[T5K]), reservasAntes, "reservas y pagos intactos");
        paso("«Cambiar grupos» abre la configuración con la selección guardada; nada se envía");

        assert.deepStrictEqual(page.erroresJs, [], `errores de JavaScript: ${page.erroresJs.join(" | ")}`);
        paso("sin errores de JavaScript en el navegador");

    } finally {
        await entorno.cerrar();
    }

}

terminar(main());
