// ==========================================================================
// PRUEBA DE EXTREMO A EXTREMO — la imagen publicada es la de «Compartir».
// Chrome real, panel Next real y publicador real. Con los mismos datos y el
// mismo diseño, en cada ancho de pantalla y diseño se generan:
//
//   A. «Compartir» en Tablas (la referencia).
//   B. Vista previa (copia oculta del modal).
//   C. Sorteo instantáneo: el PNG que recibe WhatsApp con «Publicar ahora».
//   D. Programado: el PNG que recibe WhatsApp cuando publica el publicador.
//   R. Reintento de ese programado tras un fallo de envío.
//
// Y se comparan píxel a píxel con A (no solo las dimensiones), además de la
// composición (casilla y número) y el color real de cada estado en el PNG.
//
// ENTORNO AISLADO (tests/e2e/entornoPanel.js): Supabase en memoria y un socket
// de WhatsApp SIMULADO que guarda lo que se enviaría.
//
//     node backend/tests/e2e/imagenIgualCompartir.e2e.js
//     E2E_CAPTURAS=<carpeta>   guarda los PNG y resumen.json
// ==========================================================================

process.env.GROUP_QUEUE_DELAY_MS = "0";
delete process.env.TABLA_SHARE_SECRET;
process.env.FRONTEND_URL = "http://127.0.0.1:3100";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
    PANEL, tablas: t, registrarUsuario, arrancarEntorno, servirTablas,
    rellenar, rellenarAria, marcar, pulsar, esperarTexto, fechaColombia, crearPasos
} = require("./entornoPanel");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);

const TOKEN = "e2e-token-imagen";
const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const T5K = "5k_15k_reservas_2_cifras";
registrarUsuario(TOKEN, A, "imagen@prueba.local");

const servicio = require(r("sorteos/servicio.js"));
const publicador = require(r("sorteos/publicador.js"));
const destinos = require(r("services/destinosCompartir.js"));
const { compartirEnGrupos, capturarImagenTabla } = require(r("services/compartirTabla.js"));
const { ejecutarUnaVez } = require(r("automation/executionGuard.js"));
const { guardarEvento } = require(r("bot/funciones/eventos/guardarEvento.js"));
const { consultarEventoDelSorteo } = require(r("bot/funciones/eventos/consultarEvento.js"));
const { abrirGrupo } = require(r("bot/funciones/eventos/grupos/abrirGrupo.js"));
const { actualizarEvento } = require(r("bot/funciones/reservas/actualizarEvento.js"));

const RESERVADOS = [3, 17, 42, 88];
const PAGADOS = [5, 23, 67];

// Diseños personalizados distintos: tamaño, peso, radio, separación y colores.
const celdas = (available, reserved, pagado) => ({ available, reserved, pagado });
const DISENOS = {
    clasico: {
        theme: { pageBg: "#F3ECD8", tableBg: "#D8C36A", text: "#2B2210", border: "#B89A4F", accent: "#8A6A1F" },
        cells: celdas({ bg: "#E8F2DF", border: "#9FC98A", text: "#2B2210" }, { bg: "#FBE9B0", border: "#D9A521", text: "#5C3D00" }, { bg: "#D9E9FB", border: "#5B8FC9", text: "#1C3A5C" }),
        numbers: { size: 18, weight: 700 }, grid: { radius: 8, spacing: 6, borderWidth: 1 }
    },
    compacto: {
        theme: { pageBg: "#08090C", tableBg: "#0F1115", text: "#F2F5FA", border: "#20242C", accent: "#8B7BFF" },
        cells: celdas({ bg: "#1B1F27", border: "#2E3440", text: "#F2F5FA" }, { bg: "#B4235A", border: "#E0457F", text: "#FFFFFF" }, { bg: "#127A5B", border: "#22B98B", text: "#FFFFFF" }),
        numbers: { size: 28, weight: 900 }, grid: { radius: 2, spacing: 2, borderWidth: 3 }
    },
    // El tope que acepta el backend pasa de 32 px: antes la ventana de 900 px lo recortaba.
    grande: {
        theme: { pageBg: "#FFFFFF", tableBg: "#FFFFFF", text: "#111111", border: "#DDDDDD", accent: "#2563EB" },
        cells: celdas({ bg: "#FFFFFF", border: "#CCCCCC", text: "#111111" }, { bg: "#F43F5E", border: "#F43F5E", text: "#FFFFFF" }, { bg: "#10B981", border: "#10B981", text: "#FFFFFF" }),
        numbers: { size: 40, weight: 700 }, grid: { radius: 14, spacing: 8, borderWidth: 1 }
    }
};

const ESCENARIOS = (process.env.ESCENARIOS || "clasico:1366,clasico:1024,clasico:768,clasico:600,clasico:390,compacto:1366,compacto:390,grande:1366,grande:390")
    .split(",").map(e => e.split(":")).map(([diseno, ancho]) => ({ diseno, ancho: Number(ancho) }));

// Se restablece en cada escenario: cada publicación deja su evento abierto.
function datosBase(diseno) {
    for (const tabla of Object.keys(t)) t[tabla] = [];
    t.grupos_autorizados = ["g1", "g2", "g3"].map(g => ({ usuario_id: A, grupo_id: `${g}@g.us`, activo: true }));
    t.grupos = [{ jid: "g1@g.us", nombre: "Rifa uno" }, { jid: "g2@g.us", nombre: "Rifa dos" }, { jid: "g3@g.us", nombre: "Rifa tres" }];
    t.cuentas_pago = [{ id: "cuenta-e2e", usuario_id: A, nombre: "Nequi Prueba", tipo: "nequi", numero: "3000000001", titular: "Prueba", activa: true }];
    t.sorteos_programados = [];
    t.eventos_bot = [{
        id: "e0000000-0000-4000-8000-000000000001", usuario_id: A, grupo_id: "g1@g.us", grupo_nombre: "Rifa uno",
        activo: true, abierto: true, estado: "abierto", identidad_evento_real: "det-a",
        nombre_evento: "Chontico Noche", hora_fin: "22:30", hora_cierre: "22:26", fecha_evento: fechaColombia(1),
        valor: 5000, premios: [{ tipo: "otro", nombre: "Mayor", premio: 100000 }], tabla: T5K, cifras: 2, cantidad_numeros: 100,
        creado_en: "2026-10-22T12:00:00Z"
    }];
    t[T5K] = Array.from({ length: 100 }, (_, i) => {
        const estado = RESERVADOS.includes(i) ? "reservado" : PAGADOS.includes(i) ? "pagado" : "libre";
        return { id: `${A}-${i}`, numero: String(i).padStart(2, "0"), estado, usuario_id: A, identidad_evento_real: estado === "libre" ? null : "det-a" };
    });
    t.tabla_configuracion_visual = [{ id: "cv-a-5000", usuario_id: A, precio: 5000, config: DISENOS[diseno], diseno_origen_id: null }];
}

const enviados = [];
let fallosPendientes = 0;
const sock = {
    context: { usuarioId: A, sessionId: "ses-e2e", telefono: "573000000000" },
    user: { id: "573000000000:1@s.whatsapp.net" },
    groupMetadata: async (jid) => ({ subject: `Nombre ${jid}`, participants: [{}, {}] }),
    groupSettingUpdate: async () => {},
    sendMessage: async (jid, contenido) => {
        if (fallosPendientes > 0) { fallosPendientes--; throw new Error("WhatsApp simulado sin conexión"); }
        enviados.push({ jid, image: contenido.image ? Buffer.from(contenido.image) : null });
        return { key: { id: `msg-${enviados.length}` } };
    }
};
const contextos = [];
let ultimaCaptura = null;
const deps = {
    supabase: require(r("lib/supabase.js")),
    guardarEvento, consultarEventoDelSorteo, abrirGrupo, ejecutarUnaVez, actualizarEvento,
    puedeActuar: () => true,
    // La captura real (Chromium + capturarTabla); se anotan su contexto y su PNG.
    capturarImagen: async (precio, usuario, eventoId, contexto) => {
        contextos.push(contexto);
        ultimaCaptura = await capturarImagenTabla(precio, usuario, eventoId, contexto);
        return ultimaCaptura;
    },
    textoParaCompartir: destinos.textoParaCompartir,
    compartirEnGrupos,
    sendMessage: async () => { throw new Error("el anuncio nunca sale como texto"); }
};
servicio.instantaneo._socketDe = (u) => (u === A ? sock : null);
servicio.instantaneo._deps = deps;

const { paso, terminar } = crearPasos();
const dim = (png) => ({ ancho: png.readUInt32BE(16), alto: png.readUInt32BE(20) });
const aData = (png) => `data:image/png;base64,${png.toString("base64")}`;
const dePng = (src) => Buffer.from(src.split(",")[1], "base64");
const hexRgb = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));

const medirCelda = () => {
    const c = document.querySelector('.grid-cols-10 [data-numero="05"]');
    const g = c.parentElement;
    return {
        vw: innerWidth, grid: g.offsetWidth, celda: c.getBoundingClientRect().width,
        gap: parseFloat(getComputedStyle(g).columnGap),
        margen: parseFloat(getComputedStyle(g.parentElement).paddingLeft),
        fuente: parseFloat(getComputedStyle(c.querySelector("span")).fontSize)
    };
};

// Diferencia píxel a píxel + color en el PNG de un punto dentro de cada casilla
// (la esquina interior: lejos del número y del borde).
async function comparar(page, a, b) {
    return page.evaluate(async (x, y) => {
        const leer = async (s) => {
            const img = new Image(); img.src = s; await img.decode();
            const cv = document.createElement("canvas"); cv.width = img.width; cv.height = img.height;
            const ctx = cv.getContext("2d"); ctx.drawImage(img, 0, 0);
            return ctx.getImageData(0, 0, img.width, img.height).data;
        };
        const [p, q] = await Promise.all([leer(x), leer(y)]);
        let distintos = 0;
        for (let i = 0; i < p.length; i += 4) {
            if (Math.max(Math.abs(p[i] - q[i]), Math.abs(p[i + 1] - q[i + 1]), Math.abs(p[i + 2] - q[i + 2])) > 8) distintos++;
        }
        return { distintos, total: p.length / 4 };
    }, aData(a), aData(b));
}

const colorCelda = (page, png, m, numero, borde) => page.evaluate(async (src, m, numero, borde) => {
    const img = new Image(); img.src = src; await img.decode();
    const cv = document.createElement("canvas"); cv.width = img.width; cv.height = img.height;
    const ctx = cv.getContext("2d"); ctx.drawImage(img, 0, 0);
    const i = Number(numero), paso = m.celda + m.gap;
    const px = (v) => Math.round(v * 2);
    const x = px(m.margen + (i % 10) * paso + borde + 4), y = px(m.margen + Math.floor(i / 10) * paso + borde + 4);
    return [...ctx.getImageData(x, y, 1, 1).data].slice(0, 3);
}, aData(png), m, numero, borde);

async function esperarImagenModal(page) {
    const sel = 'img[alt="Imagen de la tabla que se compartirá por WhatsApp"]';
    await page.waitForFunction((s) => { const i = document.querySelector(s); return i && i.complete && i.naturalWidth > 0; }, { timeout: 90000 }, sel);
    return dePng(await page.$eval(sel, i => i.getAttribute("src")));
}

async function llenarFormulario(page, nombre, grupo) {
    await rellenar(page, "Lotería o nombre del sorteo", nombre);
    await rellenar(page, "Hora del sorteo", "23:50");
    await rellenar(page, "Valor por número", "5000");
    await rellenarAria(page, "Premio", "Premio mayor");
    await rellenarAria(page, "Valor del premio", "300000");
    await marcar(page, grupo);
    await marcar(page, "Nequi Prueba");
}

async function escenario(entorno, { diseno, ancho }, resumen) {

    datosBase(diseno);
    const antes = JSON.stringify(t[T5K].map(f => [f.numero, f.estado]));
    const etiqueta = `${diseno}@${ancho}`;
    const page = await entorno.nuevaPagina(TOKEN);
    await page.setViewport({ width: ancho, height: 900, deviceScaleFactor: ancho < 500 ? 3 : 1, isMobile: ancho < 500 });

    // A. «Compartir»: la referencia.
    await page.goto(`${PANEL}/tablas/5000`, { waitUntil: "domcontentloaded" });
    // La referencia es la tabla con SU diseño, no la de por defecto mientras carga.
    await page.waitForFunction((rgb) => {
        const c = document.querySelector('[data-numero="05"]');
        return c && getComputedStyle(c).backgroundColor === rgb;
    }, { timeout: 60000 }, `rgb(${hexRgb(DISENOS[diseno].cells.pagado.bg).join(", ")})`);
    await pulsar(page, "Compartir");
    await esperarTexto(page, "Compartir tabla en WhatsApp");
    await page.waitForSelector('[aria-label="Vista previa del mensaje"] img', { timeout: 120000 });
    const pngA = dePng(await page.$eval('[aria-label="Vista previa del mensaje"] img', i => i.getAttribute("src")));
    const m = await page.evaluate(medirCelda);

    // B y C. Sorteo instantáneo: vista previa y lo que recibe WhatsApp.
    await page.goto(`${PANEL}/sorteo-instantaneo`, { waitUntil: "domcontentloaded" });
    await pulsar(page, "Publicar sorteo ahora");
    await esperarTexto(page, "Rifa dos");
    await esperarTexto(page, "Nequi Prueba");
    await llenarFormulario(page, `Instantáneo ${etiqueta}`, "Rifa dos");
    await pulsar(page, "Guardar y ver vista previa");
    const pngB = await esperarImagenModal(page);
    await marcar(page, "Revisé la fecha");
    await pulsar(page, "Publicar ahora");
    await esperarTexto(page, "Enviado en 1 de 1 grupo(s).", 90000);
    const pngC = enviados.at(-1).image;
    const instantaneo = t.sorteos_programados.at(-1);
    assert.ok(instantaneo.config.captura?.ventana === ancho, "el instantáneo guarda el perfil para sus reintentos");

    // D. Programado: se confirma en el panel y publica el publicador real.
    await page.goto(`${PANEL}/sorteos`, { waitUntil: "domcontentloaded" });
    await pulsar(page, "Programar sorteo");
    await esperarTexto(page, "Rifa tres");
    await esperarTexto(page, "Nequi Prueba");
    await llenarFormulario(page, `Programado ${etiqueta}`, "Rifa tres");
    await rellenar(page, "Fecha y hora de publicación", `${fechaColombia(1)}T08:00`);
    await pulsar(page, "Guardar y ver vista previa");
    await esperarImagenModal(page);
    await marcar(page, "Revisé la fecha");
    await pulsar(page, "Confirmar y programar");
    await page.waitForFunction(() => !document.body.innerText.includes("Confirmar y programar"), { timeout: 60000 });
    const programado = t.sorteos_programados.at(-1);
    assert.strictEqual(programado.estado, "programado");
    assert.ok(programado.config.captura?.ventana === ancho, "el programado recuerda el perfil de la vista previa");

    // R. Primero falla el envío; después, el reintento.
    programado.publicar_en = new Date(Date.now() - 60000).toISOString();
    const antesD = enviados.length;
    fallosPendientes = 1;
    await publicador.tick(sock, { ahora: new Date(), deps });
    fallosPendientes = 0;
    assert.ok(contextos.at(-1)?.captura?.ventana === ancho, "el publicador captura con el perfil guardado");
    // D: lo que capturó el publicador para enviar. R: lo que llegó tras reintentar.
    const pngD = ultimaCaptura;
    assert.strictEqual(enviados.length, antesD, "el primer envío falló");
    await servicio.reintentarGrupo(A, programado.id, "g3@g.us");
    await publicador.tick(sock, { ahora: new Date(), deps });
    assert.ok(enviados.length > antesD, "el reintento envía la imagen");
    const pngR = enviados.at(-1).image;

    if (process.env.E2E_CAPTURAS) {
        const dir = process.env.E2E_CAPTURAS;
        for (const [n, png] of Object.entries({ A: pngA, B: pngB, C: pngC, D: pngD, R: pngR })) fs.writeFileSync(path.join(dir, `${diseno}_${ancho}_${n}.png`), png);
    }

    const pagina = await entorno.browser.newPage();
    const fila = { escenario: etiqueta, A: `${dim(pngA).ancho}x${dim(pngA).alto}`, celda: +m.celda.toFixed(1), fuente: m.fuente, ratio: +(m.fuente / m.celda).toFixed(3) };
    const imagenes = { B: pngB, C: pngC, D: pngD, R: pngR };
    for (const [clave, png] of Object.entries(imagenes)) {
        assert.deepStrictEqual(dim(png), dim(pngA), `${etiqueta}: ${clave} con las dimensiones de A`);
        const d = await comparar(pagina, pngA, png);
        const pct = 100 * d.distintos / d.total;
        fila[`dif${clave}`] = `${pct.toFixed(3)} %`;
        assert.ok(pct < 0.5, `${etiqueta}: ${clave} difiere de A en ${pct.toFixed(3)} % de los píxeles`);
    }

    // Representación de cada estado en el PNG que llega a WhatsApp.
    const cfg = DISENOS[diseno];
    const borde = cfg.grid.borderWidth;
    for (const [nombre, png] of Object.entries(imagenes)) {
        for (const [numero, color] of [["05", cfg.cells.pagado.bg], ["03", cfg.cells.reserved.bg], ["00", cfg.cells.available.bg]]) {
            const leido = await colorCelda(pagina, png, m, numero, borde);
            const dif = Math.max(...leido.map((v, i) => Math.abs(v - hexRgb(color)[i])));
            assert.ok(dif <= 8, `${etiqueta}: ${nombre}, número ${numero}: ${leido} en vez de ${color}`);
        }
    }
    await pagina.close();

    assert.strictEqual(JSON.stringify(t[T5K].map(f => [f.numero, f.estado])), antes, "publicar no cambia reservas ni pagos");
    // isMobile recarga about:blank, donde entornoPanel no puede inyectar la sesión.
    const errores = page.erroresJs.filter(e => !e.includes("Failed to read the 'localStorage' property"));
    assert.deepStrictEqual(errores, [], "sin errores de JavaScript");

    resumen.push(fila);
    await page.close();
    paso(`${etiqueta}: A ${fila.A}, casilla ${fila.celda} px, número ${fila.fuente} px (${fila.ratio}); ${Object.keys(imagenes).map(k => `${k} ${fila[`dif${k}`]}`).join(", ")}; pagado, reservado y libre correctos`);

}

async function main() {

    servirTablas([T5K, "eventos_bot", "reservas_actividad", "tablas_cliente", "tabla_configuracion_visual", "tabla_disenos"]);

    const entorno = await arrancarEntorno({
        montarBackend: (app) => app.use("/tablas", require(r("routes/tablas.js")))
    });
    const resumen = [];

    try {
        for (const e of ESCENARIOS) await escenario(entorno, e, resumen);

        // Sin perfil (sorteos ya programados): como «Compartir» en escritorio.
        datosBase("grande");
        const page = await entorno.nuevaPagina(TOKEN);
        await page.setViewport({ width: 1366, height: 900 });
        await page.goto(`${PANEL}/tablas/5000`, { waitUntil: "domcontentloaded" });
        await pulsar(page, "Compartir");
        await page.waitForSelector('[aria-label="Vista previa del mensaje"] img', { timeout: 120000 });
        const pngA = dePng(await page.$eval('[aria-label="Vista previa del mensaje"] img', i => i.getAttribute("src")));
        const pngS = await capturarImagenTabla(5000, A);
        const d = await comparar(page, pngA, pngS);
        assert.ok(d.distintos / d.total < 0.005, `sin perfil difiere en ${d.distintos} píxeles`);
        paso(`sin perfil guardado: igual que «Compartir» en escritorio (${(100 * d.distintos / d.total).toFixed(3)} %)`);

        if (process.env.E2E_CAPTURAS) fs.writeFileSync(path.join(process.env.E2E_CAPTURAS, "resumen.json"), JSON.stringify(resumen, null, 1));
    } finally {
        console.table(resumen);
        await entorno.cerrar();
    }

}

terminar(main());
