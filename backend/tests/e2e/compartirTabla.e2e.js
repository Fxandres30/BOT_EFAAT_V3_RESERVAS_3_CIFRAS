// ==========================================================================
// PRUEBA DE EXTREMO A EXTREMO — Tablas $5.000 → «Compartir» con grupos de
// destino, con navegador real (Chrome vía puppeteer), panel Next real y API
// real (routes/tablas.js). La imagen es la captura, EN EL NAVEGADOR, del
// `div` de la tabla visible (Grid): el backend no abre ningún navegador, no
// usa página de impresión, /tablas/imprimir-datos ni TABLA_SHARE_SECRET.
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

delete process.env.TABLA_SHARE_SECRET;
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
    sendImage: async ({ jid, image, caption }) => {
        envios.push({ jid, image, caption });
        // Con E2E_CAPTURAS=<carpeta> se guarda la foto enviada para revisarla.
        if (process.env.E2E_CAPTURAS) require("fs").writeFileSync(path.join(process.env.E2E_CAPTURAS, `enviada-${envios.length}.png`), image);
    },
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
// Diseño personalizado de la tabla (preset «Clásico» de disenoDefaults.ts):
// la imagen debe conservar su fondo y los colores de las celdas.
const CLASICO = {
    theme: { pageBg: "#F3ECD8", tableBg: "#D8C36A", text: "#2B2210", border: "#B89A4F", accent: "#8A6A1F" },
    cells: {
        available: { bg: "#E8F2DF", border: "#9FC98A", text: "#2B2210" },
        reserved: { bg: "#FBE9B0", border: "#D9A521", text: "#5C3D00" },
        pagado: { bg: "#D9E9FB", border: "#5B8FC9", text: "#1C3A5C" }
    },
    numbers: { size: 18, weight: 700 },
    grid: { radius: 8, spacing: 6, borderWidth: 1 }
};
t.tabla_configuracion_visual = [{ id: "cv-a-5000", usuario_id: A, precio: 5000, config: CLASICO, diseno_origen_id: null }];

const { paso, terminar } = crearPasos();
const PNG = "89504e470d0a1a0a";

async function main() {

    servirTablas([T5K, "eventos_bot", "reservas_actividad", "tablas_cliente", "tabla_configuracion_visual", "tabla_disenos"]);

    // Cuenta las llamadas al endpoint con token: la captura ya no debe usarlo.
    let llamadasImprimirDatos = 0;
    const entorno = await arrancarEntorno({
        montarBackend: (app) => {
            app.use("/tablas/imprimir-datos", (req, res, next) => { llamadasImprimirDatos++; next(); });
            app.use("/tablas", require(path.join(RAIZ, "routes/tablas.js")));
        }
    });

    // Desde aquí, cualquier navegador que abra el BACKEND contaría: «Compartir»
    // no debe abrir ninguno (el del entorno ya está abierto).
    const pptr = require("puppeteer");
    const lanzarOriginal = pptr.launch.bind(pptr);
    let navegadoresBackend = 0;
    pptr.launch = (...args) => { navegadoresBackend++; return lanzarOriginal(...args); };

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
        assert.ok(envios.every(e => e.image.equals(Buffer.from(src.split(",")[1], "base64"))), "se envía la MISMA captura que se vio en la vista previa");
        paso("confirmación con los destinos → imagen PNG + caption a cada grupo; resultado por grupo; selección guardada");

        // La foto es SOLO la cuadrícula de números en pantalla (el `div` padre
        // de los NumeroCard) más el margen interior de su tarjeta: sin la
        // leyenda. Captura a pixelRatio 2.
        const caja = await page.evaluate(() => {
            const grid = document.querySelector('[data-numero="00"]').parentElement;
            const tarjeta = grid.parentElement;
            const g = grid.getBoundingClientRect();
            const c = document.querySelector('[data-numero="00"]').getBoundingClientRect();
            return {
                ancho: grid.offsetWidth, alto: grid.offsetHeight,
                margen: parseFloat(getComputedStyle(tarjeta).paddingLeft),
                tarjetaAlto: tarjeta.getBoundingClientRect().height,
                celda00: { x: c.left - g.left + c.width / 2, y: c.top - g.top + c.height / 2 },
                leyendaEnPanel: /Disponible/.test(tarjeta.innerText) && /Reservado/.test(tarjeta.innerText) && /Pagado/.test(tarjeta.innerText)
            };
        });
        const ancho = envios[0].image.readUInt32BE(16);
        const alto = envios[0].image.readUInt32BE(20);
        const esperadoAncho = (caja.ancho + caja.margen * 2) * 2;
        const esperadoAlto = (caja.alto + caja.margen * 2) * 2;
        assert.ok(Math.abs(ancho - esperadoAncho) <= 2 && Math.abs(alto - esperadoAlto) <= 2, `PNG ${ancho}x${alto} vs cuadrícula ${caja.ancho}x${caja.alto} + margen ${caja.margen}`);
        assert.ok(alto < caja.tarjetaAlto * 2 - 40, "más baja que la tarjeta con leyenda: la leyenda no está en la imagen");
        assert.ok(caja.leyendaEnPanel, "la leyenda sigue visible en el panel");
        paso(`la imagen es solo la cuadrícula (${ancho}x${alto} px = (${caja.ancho}x${caja.alto} + margen ${caja.margen}) × 2); la leyenda sigue en el panel`);

        // Colores del diseño personalizado conservados: fondo de la tabla en
        // la esquina y color de «Pagado» en el centro de la celda 00.
        const pixeles = await page.evaluate(async (dataUrl, punto) => {
            const img = new Image();
            img.src = dataUrl;
            await img.decode();
            const cv = document.createElement("canvas");
            cv.width = img.width; cv.height = img.height;
            const ctx = cv.getContext("2d");
            ctx.drawImage(img, 0, 0);
            const px = (x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3));
            return { esquina: px(4, 4), celda00: px(Math.round(punto.x), Math.round(punto.y)) };
        }, src, { x: (caja.celda00.x + caja.margen) * 2, y: (caja.celda00.y + caja.margen) * 2 - 14 });
        const cerca = (rgb, hex) => rgb.every((v, i) => Math.abs(v - parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16)) <= 6);
        assert.ok(cerca(pixeles.esquina, CLASICO.theme.tableBg), `fondo ${pixeles.esquina} vs ${CLASICO.theme.tableBg}`);
        assert.ok(cerca(pixeles.celda00, CLASICO.cells.pagado.bg), `celda 00 ${pixeles.celda00} vs ${CLASICO.cells.pagado.bg}`);
        paso(`conserva el diseño personalizado: fondo ${CLASICO.theme.tableBg} y «Pagado» ${CLASICO.cells.pagado.bg}`);

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

        assert.strictEqual(process.env.TABLA_SHARE_SECRET, undefined, "sin secreto en el entorno");
        assert.strictEqual(llamadasImprimirDatos, 0, "ninguna captura pasó por /tablas/imprimir-datos (enlace firmado)");
        assert.strictEqual(navegadoresBackend, 0, "el backend no abrió ningún navegador (sin Puppeteer ni página de impresión)");
        paso("sin Puppeteer en el backend, sin página de impresión, sin TABLA_SHARE_SECRET ni endpoint con token");

        assert.deepStrictEqual(page.erroresJs, [], `errores de JavaScript: ${page.erroresJs.join(" | ")}`);
        paso("sin errores de JavaScript en el navegador");

    } finally {
        await entorno.cerrar();
    }

}

terminar(main());
