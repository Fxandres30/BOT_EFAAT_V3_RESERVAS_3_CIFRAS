// ==========================================================================
// PRUEBA DE EXTREMO A EXTREMO — F4-G: un sorteo PROGRAMADO genera a su hora
// una imagen NUEVA con el MISMO generador que «Compartir tabla», sin ningún
// navegador del administrador abierto. Chrome real y panel Next real.
//
//   1. «Compartir» en Tablas $3.000 (estado S1): captura del panel
//      (capturarTabla sobre TablaImprimible) y perfil de la columna.
//   2. Se programa un sorteo con «Confirmar y programar» (captura S1).
//   3. Se CIERRA el navegador del administrador. Después de programar se
//      reserva y se paga un número (estado S2).
//   4. A la hora, el publicador (ciclo real) relee la tabla y genera la
//      imagen: compartirTabla.capturarImagenTabla abre /tablas/imprimir con
//      Chromium headless y ejecuta allí capturarTabla. Se envía por
//      compartirEnGrupos (sendImage SIMULADO: nada sale a WhatsApp).
//   5. La imagen enviada NO es la de S1 y es idéntica, píxel a píxel, a la
//      que «Compartir» produce en el panel para S2.
//   6. Ciclos simultáneos y posteriores: ninguna generación ni envío extra.
//
// ENTORNO AISLADO (tests/e2e/entornoPanel.js): Supabase falso en memoria,
// sin WhatsApp, sin SQL.
//
//     node backend/tests/e2e/f4gImagenProgramada.e2e.js
//     (E2E_CAPTURAS=<carpeta> guarda las imágenes para verlas)
// ==========================================================================

const assert = require("assert");
const fs = require("fs");
const path = require("path");

delete process.env.TABLA_SHARE_SECRET;
process.env.FRONTEND_URL = "http://127.0.0.1:3100";
process.env.EFAAT_PRUEBAS = "1";

const {
    PANEL, tablas: t, registrarUsuario, arrancarEntorno, servirTablas,
    pulsar, esperarTexto, crearPasos
} = require("./entornoPanel");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);
function inyectar(rutaRel, exportsObj) {
    const abs = r(rutaRel);
    require.cache[abs] = { id: abs, filename: abs, loaded: true, exports: exportsObj };
}

const TOKEN = "e2e-token-f4g";
const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const T5K = "5k_15k_reservas_2_cifras";   // $3.000
const PRECIO = 3000;

registrarUsuario(TOKEN, A, "f4g@prueba.local");

// WhatsApp SIMULADO: se registra lo que se habría enviado; nada sale.
const imagenesEnviadas = [];
const textosEnviados = [];
inyectar("services/baileys/send.js", {
    sendImage: async ({ jid, image, caption }) => { imagenesEnviadas.push({ jid, image: Buffer.from(image), caption }); return { key: { id: `img-${imagenesEnviadas.length}` } }; },
    sendMessage: async ({ jid, text } = {}) => { textosEnviados.push({ jid, text }); return { key: { id: `txt-${textosEnviados.length}` } }; }
});
inyectar("services/baileys/manager.js", { getSocketActivoDe: (u) => (u === A ? { usuario: A } : null) });

const sock = {
    context: { usuarioId: A, sessionId: "ses-aaaa", telefono: "573000000000" },
    user: { id: "573000000000:1@s.whatsapp.net" },
    groupMetadata: async (jid) => ({ subject: `Nombre ${jid}`, participants: [{}, {}] }),
    groupSettingUpdate: async () => {},
    sendMessage: async () => { throw new Error("nada se envía directamente al socket en esta prueba"); }
};

t.grupos_autorizados = [{ usuario_id: A, grupo_id: "g1@g.us", activo: true }, { usuario_id: A, grupo_id: "g2@g.us", activo: true }];
t.grupos = [{ jid: "g1@g.us", nombre: "Rifa uno" }, { jid: "g2@g.us", nombre: "Rifa dos" }];
t.cuentas_pago = [{ id: "cuenta-a1", usuario_id: A, nombre: "Nequi A", tipo: "nequi", numero: "3000000001", titular: "A", activa: true }];
t.eventos_bot = [];
t.reservas_archivo = [];
t[T5K] = Array.from({ length: 100 }, (_, i) => ({
    id: `${A}-${i}`, numero: String(i).padStart(2, "0"), usuario_id: A,
    estado: [3, 17, 42].includes(i) ? "reservado" : i === 88 ? "pagado" : "libre"
}));
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
t.tabla_configuracion_visual = [{ id: "cv-a-3000", usuario_id: A, precio: PRECIO, config: CLASICO, diseno_origen_id: null }];

const { paso, terminar } = crearPasos();
const dim = (png) => ({ ancho: png.readUInt32BE(16), alto: png.readUInt32BE(20) });

// Hoy 15/10; se publica el 22/10 08:00 (Colombia).
const T0 = new Date("2026-10-15T15:00:00Z");
const EN_PUBLICACION = new Date("2026-10-22T13:01:00Z");
const DESPUES = new Date("2026-10-22T13:05:00Z");

// «Compartir» en Tablas: la imagen que produce el panel + su perfil.
async function compartirEnPanel(entorno) {
    const page = await entorno.nuevaPagina(TOKEN);
    // La imagen de «Compartir» es la que el botón envía en POST /api/tablas/compartir
    // (capturarTabla). Se toma de esa petición y se responde «sin_destinos»
    // en el propio navegador: la petición no llega al backend, nada se envía.
    let resolverImagen;
    const imagenPedida = new Promise(res => { resolverImagen = res; });
    await page.setRequestInterception(true);
    page.on("request", (req) => {
        let ruta = "";
        try { ruta = new URL(req.url()).pathname; } catch { /* no estándar */ }
        if (ruta === "/api/tablas/compartir" && req.method() === "POST") {
            try { resolverImagen(JSON.parse(req.postData() || "{}").imagen); } catch { resolverImagen(null); }
            req.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: false, enviado: false, motivo: "sin_destinos" }) });
        } else {
            req.continue();
        }
    });
    await page.goto(`${PANEL}/tablas/${PRECIO}`, { waitUntil: "domcontentloaded" });
    // Diseño propio cargado (celda reservada del diseño CLASICO).
    await page.waitForFunction(() => { const c = document.querySelector('[data-numero="17"]'); return c && getComputedStyle(c).backgroundColor === "rgb(251, 233, 176)"; }, { timeout: 120000 });
    await pulsar(page, "Compartir");
    const src = await Promise.race([imagenPedida, new Promise((_, rej) => setTimeout(() => rej(new Error("«Compartir» no envió ninguna imagen")), 120000))]);
    assert.ok(typeof src === "string" && src.startsWith("data:image/png;base64,"), "«Compartir» produjo un PNG");
    await esperarTexto(page, "Compartir tabla en WhatsApp");
    // Mismo cálculo que frontend/services/tablas/perfilCaptura.ts.
    const perfil = await page.evaluate(() => {
        const main = document.querySelector("main");
        const e = getComputedStyle(main);
        return { ventana: window.innerWidth, contenido: Math.round(main.clientWidth - parseFloat(e.paddingLeft) - parseFloat(e.paddingRight)) };
    });
    return { page, png: Buffer.from(src.split(",")[1], "base64"), perfil };
}

async function diferenciaPixeles(page, a, b) {
    return page.evaluate(async (x64, y64) => {
        const pixeles = async (s) => {
            const img = new Image(); img.src = s; await img.decode();
            const cv = document.createElement("canvas"); cv.width = img.width; cv.height = img.height;
            const ctx = cv.getContext("2d"); ctx.drawImage(img, 0, 0);
            return ctx.getImageData(0, 0, img.width, img.height).data;
        };
        const [x, y] = await Promise.all([pixeles(x64), pixeles(y64)]);
        if (x.length !== y.length) return { distintos: Infinity, total: x.length / 4, maximo: 255 };
        let distintos = 0, maximo = 0;
        for (let i = 0; i < x.length; i += 4) {
            const d = Math.max(Math.abs(x[i] - y[i]), Math.abs(x[i + 1] - y[i + 1]), Math.abs(x[i + 2] - y[i + 2]));
            if (d > 8) distintos++;
            if (d > maximo) maximo = d;
        }
        return { distintos, total: x.length / 4, maximo };
    }, `data:image/png;base64,${a.toString("base64")}`, `data:image/png;base64,${b.toString("base64")}`);
}

async function silencio(fn) {
    const { log, table, dir, warn } = console;
    console.log = console.table = console.dir = console.warn = () => {};
    try { return await fn(); } finally { Object.assign(console, { log, table, dir, warn }); }
}

async function main() {

    servirTablas([T5K, "eventos_bot", "reservas_actividad", "tablas_cliente", "tabla_configuracion_visual", "tabla_disenos"]);

    const entorno = await arrancarEntorno({
        montarBackend: (app) => app.use("/tablas", require(r("routes/tablas.js")))
    });

    try {

        const servicio = require(r("sorteos/servicio.js"));
        const publicador = require(r("sorteos/publicador.js"));
        const capturaProgramada = require(r("sorteos/capturaProgramada.js"));
        const compartirTabla = require(r("services/compartirTabla.js"));
        let reloj = T0;
        servicio._reloj.ahora = () => reloj;

        // Cuenta las ejecuciones REALES del generador en el servidor.
        const capturarReal = compartirTabla.capturarImagenTabla;
        let generacionesServidor = 0;
        compartirTabla.capturarImagenTabla = async (...args) => { generacionesServidor++; return capturarReal(...args); };

        // 1. «Compartir» con la tabla en S1.
        const s1 = await compartirEnPanel(entorno);
        paso(`«Compartir» en el panel (S1): ${dim(s1.png).ancho}x${dim(s1.png).alto} px; perfil ventana ${s1.perfil.ventana} / columna ${s1.perfil.contenido}`);

        // 2. Programar el sorteo con la captura S1 (lo que hace «Confirmar y programar»).
        const creado = await silencio(() => servicio.crearSorteo(A, {
            modalidad: "dos_cifras", nombre: "Lotería F4-G", hora_fin: "22:30", valor: PRECIO,
            premios: [{ nombre: "Premio mayor", premio: 300000 }], grupos: ["g1@g.us", "g2@g.us"], cuentas: ["cuenta-a1"],
            publicar_en: "2026-10-22T13:00:00Z", fecha_sorteo: "2026-10-22",
            mensajes: { publicacion: "", aviso_cierre: "" }, recordatorios: []
        }));
        assert.ok(creado.ok, JSON.stringify(creado));
        const vista = await silencio(() => servicio.vistaPrevia(A, creado.data.id));
        assert.ok(vista.ok, JSON.stringify(vista));
        const conf = await silencio(() => servicio.confirmar(A, creado.data.id, {
            version: creado.data.version, confirmacion: true,
            imagen: `data:image/png;base64,${s1.png.toString("base64")}`, huella: vista.data.huella_tabla, captura: s1.perfil
        }));
        assert.ok(conf.ok, JSON.stringify(conf));
        assert.strictEqual((await capturaProgramada.leer(creado.data.id)).origen, "confirmar");
        paso("sorteo programado con «Confirmar y programar» (captura S1 guardada, perfil del dispositivo guardado)");

        // 3. Sin navegador del administrador. La tabla cambia después de programar.
        await s1.page.browserContext().close();
        const pestañas = (await entorno.browser.pages()).filter(p => p.url().startsWith(PANEL));
        assert.strictEqual(pestañas.length, 0, "ninguna pestaña del panel abierta");
        Object.assign(t[T5K][55], { estado: "reservado" });
        Object.assign(t[T5K][3], { estado: "pagado" });
        paso("navegador del administrador cerrado; después de programar se reserva el 55 y se paga el 03 (S2)");

        // 4. A la hora: ciclo real del publicador, sin panel abierto.
        reloj = EN_PUBLICACION;
        const deps = { ...publicador.dependenciasReales(), puedeActuar: () => true };
        const inicio = Date.now();
        await silencio(() => publicador.tick(sock, { ahora: EN_PUBLICACION, deps }));
        const ms = Date.now() - inicio;
        const grupos = t.sorteos_programados_grupos.filter(g => g.sorteo_id === creado.data.id);
        for (const g of grupos) assert.strictEqual(g.estado, "publicado", `${g.grupo_id}: ${g.ultimo_error}`);
        assert.strictEqual(imagenesEnviadas.length, 2, "una imagen por grupo");
        assert.strictEqual(generacionesServidor, 1, "UNA generación real (Chromium) para los dos grupos");
        const automatica = imagenesEnviadas[0].image;
        assert.ok(imagenesEnviadas[1].image.equals(automatica), "la misma imagen en los dos grupos");
        assert.deepStrictEqual(imagenesEnviadas.map(e => e.jid).sort(), ["g1@g.us", "g2@g.us"], "solo los grupos del sorteo");
        paso(`a la hora, sin panel: Chromium headless ejecutó capturarTabla y se publicó en g1 y g2 (${ms} ms, 1 generación)`);

        // 5. Comparación visual: S2 automática vs «Compartir» del panel en S2.
        const s2 = await compartirEnPanel(entorno);
        assert.ok(!automatica.equals(s1.png), "no es la captura S1 de la confirmación");
        const contraS1 = await diferenciaPixeles(s2.page, automatica, s1.png);
        assert.ok(contraS1.distintos > 0, "la imagen automática refleja los cambios de S2 (difiere de S1)");
        assert.deepStrictEqual(dim(automatica), dim(s2.png), "mismas dimensiones que «Compartir»");
        const d = await diferenciaPixeles(s2.page, automatica, s2.png);
        const porcentaje = (100 * d.distintos / d.total).toFixed(3);
        if (process.env.E2E_CAPTURAS) {
            fs.mkdirSync(process.env.E2E_CAPTURAS, { recursive: true });
            fs.writeFileSync(path.join(process.env.E2E_CAPTURAS, "f4g_compartir_S1.png"), s1.png);
            fs.writeFileSync(path.join(process.env.E2E_CAPTURAS, "f4g_compartir_S2.png"), s2.png);
            fs.writeFileSync(path.join(process.env.E2E_CAPTURAS, "f4g_programado_S2.png"), automatica);
        }
        assert.ok(d.distintos / d.total < 0.005, `píxeles distintos: ${d.distintos}/${d.total} (${porcentaje} %)`);
        paso(`imagen automática = «Compartir» en S2: ${dim(automatica).ancho}x${dim(automatica).alto} px; píxeles distintos ${d.distintos}/${d.total} (${porcentaje} %, dif. máx. ${d.maximo}/255); contra S1: ${contraS1.distintos} distintos`);
        await s2.page.browserContext().close();

        // 6. Ciclos simultáneos y posteriores: nada se repite.
        reloj = DESPUES;
        await silencio(() => Promise.all([publicador.tick(sock, { ahora: DESPUES, deps }), publicador.tick(sock, { ahora: DESPUES, deps })]));
        assert.strictEqual(imagenesEnviadas.length, 2, "sin envíos duplicados");
        assert.strictEqual(generacionesServidor, 1, "sin generaciones extra");
        paso("dos ciclos simultáneos después: 0 envíos y 0 generaciones adicionales");

    } finally {
        await entorno.cerrar();
    }

}

terminar(main());
