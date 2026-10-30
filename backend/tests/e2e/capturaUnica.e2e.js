// ==========================================================================
// PRUEBA DE EXTREMO A EXTREMO — UNA SOLA CAPTURA para «Compartir» y para
// publicar sorteos (FASE UX-04), con Chrome real y el panel Next real.
//
//   1. «Compartir» en Tablas $5.000: el panel captura la cuadrícula con
//      capturarTabla (frontend/services/tablas/capturarTabla.ts).
//   2. La captura del servidor (compartirTabla.capturarImagenTabla, la que
//      usan las publicaciones programadas y los reintentos) abre la página
//      de impresión del MISMO panel con Chromium y ejecuta allí esa MISMA
//      función: no hace foto propia.
//   3. Ambas imágenes: mismas dimensiones y mismos píxeles.
//   4. El publicador usa esa captura; la vista previa también (sin pedir
//      otra al servidor).
//
// La tabla solo tiene números libres y reservados: la página de impresión
// recibe libre/ocupado (sin datos personales) y pinta los ocupados como
// «Reservado»; un «Pagado» se ve distinto en Tablas (limitación conocida,
// no de la captura).
//
// ENTORNO AISLADO (tests/e2e/entornoPanel.js): no toca Supabase. WhatsApp no
// interviene: esta prueba no envía nada.
//
//     node backend/tests/e2e/capturaUnica.e2e.js
// ==========================================================================

const assert = require("assert");
const fs = require("fs");
const path = require("path");

delete process.env.TABLA_SHARE_SECRET;
process.env.FRONTEND_URL = "http://127.0.0.1:3100";

const {
    PANEL, tablas: t, registrarUsuario, arrancarEntorno, servirTablas,
    pulsar, esperarTexto, fechaColombia, crearPasos
} = require("./entornoPanel");

const RAIZ = path.resolve(__dirname, "../..");
function inyectar(rutaRel, exportsObj) {
    const abs = path.join(RAIZ, rutaRel);
    require.cache[abs] = { id: abs, filename: abs, loaded: true, exports: exportsObj };
}

const TOKEN = "e2e-token-captura-unica";
const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const T5K = "5k_15k_reservas_2_cifras";

registrarUsuario(TOKEN, A, "captura@prueba.local");

inyectar("services/baileys/send.js", {
    sendImage: async () => { throw new Error("esta prueba no envía nada"); },
    sendMessage: async () => { throw new Error("esta prueba no envía nada"); }
});
inyectar("services/baileys/manager.js", { getSocketActivoDe: (u) => (u === A ? { usuario: A } : null) });

t.grupos_autorizados = [{ usuario_id: A, grupo_id: "g1@g.us", activo: true }];
t.grupos = [{ jid: "g1@g.us", nombre: "Rifa uno" }];
t.eventos_bot = [{
    id: "e0000000-0000-4000-8000-000000000001", usuario_id: A, grupo_id: "g1@g.us", grupo_nombre: "Rifa uno",
    activo: true, abierto: true, estado: "abierto", identidad_evento_real: "det-a",
    nombre_evento: "Chontico Noche", hora_fin: "22:30", hora_cierre: "22:26", fecha_evento: fechaColombia(1),
    valor: 5000, premios: [{ tipo: "otro", nombre: "Mayor", premio: 100000 }], tabla: T5K, cifras: 2, cantidad_numeros: 100,
    creado_en: "2026-10-22T12:00:00Z"
}];
t[T5K] = Array.from({ length: 100 }, (_, i) => ({ id: `${A}-${i}`, numero: String(i).padStart(2, "0"), estado: [3, 17, 42, 88].includes(i) ? "reservado" : "libre", usuario_id: A }));
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
const dim = (png) => ({ ancho: png.readUInt32BE(16), alto: png.readUInt32BE(20) });

async function main() {

    servirTablas([T5K, "eventos_bot", "reservas_actividad", "tablas_cliente", "tabla_configuracion_visual", "tabla_disenos"]);

    const entorno = await arrancarEntorno({
        montarBackend: (app) => app.use("/tablas", require(path.join(RAIZ, "routes/tablas.js")))
    });

    try {

        const page = await entorno.nuevaPagina(TOKEN);
        const reservasAntes = JSON.stringify(t[T5K]);

        // 1. «Compartir»: la captura del panel.
        await page.goto(`${PANEL}/tablas/5000`, { waitUntil: "domcontentloaded" });
        await pulsar(page, "Compartir");
        await esperarTexto(page, "Compartir tabla en WhatsApp");
        await page.waitForSelector('[aria-label="Vista previa del mensaje"] img', { timeout: 120000 });
        const src = await page.$eval('[aria-label="Vista previa del mensaje"] img', i => i.getAttribute("src"));
        const pngCompartir = Buffer.from(src.split(",")[1], "base64");
        paso(`«Compartir» captura en el panel: ${dim(pngCompartir).ancho}x${dim(pngCompartir).alto} px`);

        // 2. La captura del servidor: Chromium real + capturarTabla en la página.
        const pptr = require("puppeteer");
        const lanzar = pptr.launch.bind(pptr);
        const llamadas = { evaluate: 0, screenshot: 0 };
        pptr.launch = async (...args) => {
            const nav = await lanzar(...args);
            const nueva = nav.newPage.bind(nav);
            nav.newPage = async () => {
                const p = await nueva();
                const ev = p.evaluate.bind(p);
                const sc = p.screenshot.bind(p);
                Object.defineProperty(p, "evaluate", { configurable: true, value: (fn, ...a) => { if (/__efaatCapturarTabla/.test(String(fn))) llamadas.evaluate++; return ev(fn, ...a); } });
                Object.defineProperty(p, "screenshot", { configurable: true, value: (...a) => { llamadas.screenshot++; return sc(...a); } });
                // Ni la foto de un elemento (ElementHandle.screenshot).
                const espera = p.waitForSelector.bind(p);
                Object.defineProperty(p, "waitForSelector", { configurable: true, value: async (...a) => {
                    const h = await espera(...a);
                    if (h) { const hs = h.screenshot.bind(h); Object.defineProperty(h, "screenshot", { configurable: true, value: (...b) => { llamadas.screenshot++; return hs(...b); } }); }
                    return h;
                } });
                return p;
            };
            return nav;
        };
        const { capturarImagenTabla } = require(path.join(RAIZ, "services/compartirTabla.js"));
        const pngServidor = await capturarImagenTabla(5000, A);
        pptr.launch = lanzar;
        assert.deepStrictEqual(llamadas, { evaluate: 1, screenshot: 0 }, "Chromium ejecuta capturarTabla y no fotografía nada");
        paso("el servidor no fotografía: Chromium ejecuta en la página la función de «Compartir» (1 llamada, 0 capturas propias)");

        // 3. Misma imagen: dimensiones y píxeles.
        assert.deepStrictEqual(dim(pngServidor), dim(pngCompartir), "mismas dimensiones");
        const diferencia = await page.evaluate(async (a, b) => {
            const pixeles = async (s) => {
                const img = new Image(); img.src = s; await img.decode();
                const cv = document.createElement("canvas"); cv.width = img.width; cv.height = img.height;
                const ctx = cv.getContext("2d"); ctx.drawImage(img, 0, 0);
                return ctx.getImageData(0, 0, img.width, img.height).data;
            };
            const [x, y] = await Promise.all([pixeles(a), pixeles(b)]);
            let distintos = 0, maximo = 0;
            for (let i = 0; i < x.length; i += 4) {
                const d = Math.max(Math.abs(x[i] - y[i]), Math.abs(x[i + 1] - y[i + 1]), Math.abs(x[i + 2] - y[i + 2]));
                if (d > 8) distintos++;
                if (d > maximo) maximo = d;
            }
            return { distintos, total: x.length / 4, maximo };
        }, src, `data:image/png;base64,${pngServidor.toString("base64")}`);
        if (process.env.E2E_CAPTURAS) {
            fs.writeFileSync(path.join(process.env.E2E_CAPTURAS, "compartir.png"), pngCompartir);
            fs.writeFileSync(path.join(process.env.E2E_CAPTURAS, "publicar.png"), pngServidor);
        }
        const porcentaje = (100 * diferencia.distintos / diferencia.total).toFixed(3);
        assert.ok(diferencia.distintos / diferencia.total < 0.005, `píxeles distintos: ${diferencia.distintos}/${diferencia.total} (${porcentaje} %)`);
        paso(`misma imagen: ${dim(pngServidor).ancho}x${dim(pngServidor).alto} px en ambas; píxeles distintos ${diferencia.distintos}/${diferencia.total} (${porcentaje} %, diferencia máx. ${diferencia.maximo}/255)`);

        // 4. Publicador y vista previa usan esa captura.
        const publicador = require(path.join(RAIZ, "sorteos/publicador.js"));
        assert.strictEqual(publicador.dependenciasReales().capturarImagen, capturarImagenTabla, "programados y reintentos capturan con capturarImagenTabla");
        const modal = fs.readFileSync(path.join(RAIZ, "../frontend/components/sorteos/VistaPreviaModal.tsx"), "utf8");
        assert.ok(/capturarTabla\(capturaRef\.current\)/.test(modal) && !/imagenPrueba/.test(modal), "la vista previa captura con capturarTabla");
        assert.strictEqual(JSON.stringify(t[T5K]), reservasAntes, "reservas intactas");
        paso("programados/reintentos → capturarImagenTabla (esta captura); vista previa e instantáneo → capturarTabla en el panel; reservas intactas");

    } finally {
        await entorno.cerrar();
    }

    terminar();

}

main().catch((err) => { console.error(err); process.exit(1); });
