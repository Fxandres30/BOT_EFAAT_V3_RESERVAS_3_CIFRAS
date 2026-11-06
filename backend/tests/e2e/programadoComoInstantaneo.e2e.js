// ==========================================================================
// PRUEBA DE EXTREMO A EXTREMO — sorteo PROGRAMADO con la MISMA imagen que el
// instantáneo, con un navegador real (Chrome vía puppeteer), el panel Next
// real (next dev) y la API real del backend.
//
//   1. «Revisar y confirmar»: la vista previa captura la tabla en el navegador
//      (capturarTabla, la de «Compartir») y «Confirmar y programar» la guarda.
//   2. A la hora, el publicador envía ESA captura (mismos bytes), con el pie
//      de siempre, solo al grupo del sorteo, sin Chromium en el servidor.
//   3. Si la tabla cambió antes de la hora: revisión sin enviar nada;
//      «Reintentar» abre la vista previa, captura de nuevo y publica ese
//      grupo una sola vez.
//
// ENTORNO AISLADO (tests/e2e/entornoPanel.js): Supabase en memoria y un
// socket de WhatsApp SIMULADO. No toca Supabase ni WhatsApp reales.
//
//     node backend/tests/e2e/programadoComoInstantaneo.e2e.js
// ==========================================================================

process.env.GROUP_QUEUE_DELAY_MS = "0";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const DIR_CAPTURAS = fs.mkdtempSync(path.join(os.tmpdir(), "efaat-capturas-e2e-"));
process.env.EFAAT_CAPTURAS_DIR = DIR_CAPTURAS;

const {
    PANEL, tablas: t, peticionesSupabase, registrarUsuario, arrancarEntorno,
    marcar, pulsar, esperarTexto, captura, crearPasos
} = require("./entornoPanel");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);

const servicio = require(r("sorteos/servicio.js"));
const publicador = require(r("sorteos/publicador.js"));
const capturaProgramada = require(r("sorteos/capturaProgramada.js"));
const destinos = require(r("services/destinosCompartir.js"));
const compartirTabla = require(r("services/compartirTabla.js"));
const { ejecutarUnaVez } = require(r("automation/executionGuard.js"));
const { guardarEvento } = require(r("bot/funciones/eventos/guardarEvento.js"));
const { consultarEventoDelSorteo } = require(r("bot/funciones/eventos/consultarEvento.js"));
const { abrirGrupo } = require(r("bot/funciones/eventos/grupos/abrirGrupo.js"));
const { actualizarEvento } = require(r("bot/funciones/reservas/actualizarEvento.js"));

const TOKEN_USUARIO = "e2e-token-programado";
const A = "aaaaaaaa-0000-4000-8000-00000000000a";
registrarUsuario(TOKEN_USUARIO, A, "e2e@prueba.local");

t.grupos_autorizados = [
    { usuario_id: A, grupo_id: "g1@g.us", activo: true },
    { usuario_id: A, grupo_id: "g2@g.us", activo: true }
];
t.grupos = [{ jid: "g1@g.us", nombre: "Grupo Prueba Uno" }, { jid: "g2@g.us", nombre: "Grupo Prueba Dos" }];
t.cuentas_pago = [{ id: "cuenta-e2e", usuario_id: A, nombre: "Nequi Prueba", tipo: "nequi", numero: "3000000001", titular: "Prueba", activa: true }];
t.eventos_bot = [];
t.reservas_archivo = [];
for (const tabla of ["reservas_dos_cifras", "5k_15k_reservas_2_cifras"]) {
    t[tabla] = Array.from({ length: 100 }, (_, i) => ({ numero: String(i).padStart(2, "0"), estado: i === 5 ? "pagado" : i === 6 ? "reservado" : "libre", usuario_id: A }));
}

// Mañana 08:00 de Colombia = 13:00 UTC.
const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const manana = (() => { const d = new Date(`${hoy}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); })();
const PUBLICAR = new Date(`${manana}T13:00:00Z`);
const EN_PUBLICACION = new Date(`${manana}T13:01:00Z`);
const SIGUIENTE = new Date(`${manana}T13:01:30Z`);
const AL_REINTENTAR = new Date(`${manana}T13:03:00Z`);

const enviados = [];
const sock = {
    context: { usuarioId: A, sessionId: "ses-e2e", telefono: "573000000000" },
    user: { id: "573000000000:1@s.whatsapp.net" },
    groupMetadata: async (jid) => ({ subject: `Nombre ${jid}`, participants: [{}, {}] }),
    groupSettingUpdate: async () => {},
    sendMessage: async (jid, contenido) => {
        enviados.push({ jid, tipo: contenido.image ? "imagen" : "texto", image: contenido.image, texto: contenido.caption ?? contenido.text });
        return { key: { id: `msg-${enviados.length}` } };
    }
};

// La captura del servidor (Chromium) NO debe usarse.
let capturasServidor = 0;
compartirTabla.capturarImagenTabla = async () => { capturasServidor++; throw new Error("Falta FRONTEND_URL (simulado)"); };

// Dependencias REALES del publicador (la imagen sale de capturaProgramada).
const deps = {
    ...publicador.dependenciasReales(),
    supabase: require(r("lib/supabase.js")),
    puedeActuar: () => true,
    sendMessage: async () => { throw new Error("el anuncio nunca sale como texto"); }
};
servicio.instantaneo._socketDe = (u) => (u === A ? sock : null);
servicio.instantaneo._deps = deps;

function entrada(extra) {
    return {
        modalidad: "dos_cifras", hora_fin: "22:30", premios: [{ nombre: "Premio mayor", premio: 300000 }],
        cuentas: ["cuenta-e2e"], publicar_en: PUBLICAR.toISOString(), fecha_sorteo: manana,
        mensajes: { publicacion: "", aviso_cierre: "" }, recordatorios: [], ...extra
    };
}

const imagenDeLaVista = async (page) => {
    const sel = 'img[alt="Imagen de la tabla que se compartirá por WhatsApp"]';
    await page.waitForFunction((sel) => { const img = document.querySelector(sel); return img && img.complete && img.naturalWidth > 0; }, { timeout: 60000 }, sel);
    const src = await page.$eval(sel, i => i.getAttribute("src"));
    const png = Buffer.from(src.split(",")[1], "base64");
    assert.ok(png.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")), "PNG real del panel");
    return png;
};

// Pulsa un botón DENTRO de la tarjeta del sorteo `nombre`.
async function pulsarEnTarjeta(page, nombre, texto) {
    await page.waitForFunction((nombre, texto) => {
        const h = [...document.querySelectorAll("h3")].find(x => x.textContent.includes(nombre));
        let c = h; while (c && ![...c.querySelectorAll("button")].some(b => b.textContent.trim() === texto)) c = c.parentElement;
        const b = c && [...c.querySelectorAll("button")].find(b => b.textContent.trim() === texto && !b.disabled);
        if (b) b.click();
        return !!b;
    }, { timeout: 60000 }, nombre, texto);
}

const tick = (ahora) => publicador.tick(sock, { ahora, deps });
const { paso, terminar } = crearPasos();

async function main() {

    const s1 = await servicio.crearSorteo(A, entrada({ nombre: "Lotería E2E Programada", valor: 5000, grupos: ["g1@g.us"] }));
    const s2 = await servicio.crearSorteo(A, entrada({ nombre: "Lotería E2E Reintento", valor: 2000, grupos: ["g2@g.us"] }));
    assert.ok(s1.ok && s2.ok, JSON.stringify([s1, s2]));

    const entorno = await arrancarEntorno();

    try {

        const page = await entorno.nuevaPagina(TOKEN_USUARIO);
        await page.setViewport({ width: 1366, height: 900 });

        // 1. Confirmar y programar desde el panel: la captura del navegador se guarda.
        const confirmarEnPanel = async (nombre) => {
            await page.goto(`${PANEL}/sorteos`, { waitUntil: "domcontentloaded" });
            await esperarTexto(page, nombre);
            await pulsarEnTarjeta(page, nombre, "Revisar y confirmar");
            const png = await imagenDeLaVista(page);
            await esperarTexto(page, "Es la imagen que se publicará a la hora programada");
            await marcar(page, "Revisé la fecha");
            await pulsar(page, "Confirmar y programar");
            await page.waitForFunction(() => !document.body.innerText.includes("Confirmar y programar"), { timeout: 60000 });
            return png;
        };

        const png1 = await confirmarEnPanel("Lotería E2E Programada");
        const sorteo1 = t.sorteos_programados.find(x => x.id === s1.data.id);
        assert.strictEqual(sorteo1.estado, "programado");
        const guardada1 = await capturaProgramada.leer(s1.data.id);
        assert.ok(guardada1 && guardada1.png.equals(png1), "se guardó la MISMA captura que mostró la vista previa");
        await captura(page, "programado_confirmado");
        paso(`«Confirmar y programar»: la captura del navegador (${png1.readUInt32BE(16)}x${png1.readUInt32BE(20)} px) queda guardada con la versión ${guardada1.version}`);

        const png2 = await confirmarEnPanel("Lotería E2E Reintento");
        assert.ok((await capturaProgramada.leer(s2.data.id))?.png.equals(png2));

        // 2. A la hora: se envía esa captura, solo al grupo del sorteo.
        // El sorteo 2 recibe una reserva nueva antes de la hora (paso 3).
        t.reservas_dos_cifras[40].estado = "reservado";
        await tick(EN_PUBLICACION);
        await tick(SIGUIENTE);
        const aG1 = enviados.filter(e => e.jid === "g1@g.us");
        assert.strictEqual(aG1.length, 1, "una sola publicación en g1");
        assert.strictEqual(aG1[0].tipo, "imagen");
        assert.ok(Buffer.from(aG1[0].image).equals(png1), "se publica la captura del panel, byte a byte");
        assert.ok(aG1[0].texto.includes("Lotería E2E Programada") && aG1[0].texto.includes("Nequi Prueba"), aG1[0].texto);
        assert.strictEqual(capturasServidor, 0, "el servidor no capturó nada");
        paso("a la hora: 1 mensaje en «Grupo Prueba Uno» con la MISMA imagen de la vista previa y el anuncio; sin Chromium del servidor");

        // 3. Tabla cambiada: revisión sin enviar; «Reintentar» con captura nueva.
        const g2 = t.sorteos_programados_grupos.find(x => x.sorteo_id === s2.data.id);
        assert.strictEqual(g2.estado, "requiere_revision");
        assert.ok(/la tabla cambió/.test(g2.ultimo_error), g2.ultimo_error);
        assert.strictEqual(enviados.filter(e => e.jid === "g2@g.us").length, 0, "no se envió una imagen desactualizada");

        servicio._reloj.ahora = () => AL_REINTENTAR;
        await page.goto(`${PANEL}/sorteos`, { waitUntil: "domcontentloaded" });
        await esperarTexto(page, "Lotería E2E Reintento");
        await esperarTexto(page, "la tabla cambió");
        await captura(page, "programado_tabla_cambiada");
        await pulsarEnTarjeta(page, "Lotería E2E Reintento", "Reintentar");
        await esperarTexto(page, "Reintentar en «Grupo Prueba Dos»");
        const png3 = await imagenDeLaVista(page);
        assert.ok(!png3.equals(png2), "captura nueva, con la reserva nueva");
        await page.evaluate(() => {
            const b = [...document.querySelectorAll("button")].find(x => x.textContent.trim() === "Publicar ahora en «Grupo Prueba Dos»" && !x.disabled);
            b.click(); b.click();
        });
        await esperarTexto(page, "Publicado en Grupo Prueba Dos.");
        await captura(page, "programado_reintentado");
        const aG2 = enviados.filter(e => e.jid === "g2@g.us");
        assert.strictEqual(aG2.length, 1, "una sola publicación (doble clic)");
        assert.ok(Buffer.from(aG2[0].image).equals(png3), "la captura nueva");
        await tick(new Date(AL_REINTENTAR.getTime() + 60000));
        assert.strictEqual(enviados.filter(e => e.jid === "g2@g.us").length, 1, "el ciclo siguiente no repite");
        assert.strictEqual(capturasServidor, 0);
        paso("tabla cambiada: revisión sin enviar; «Reintentar» abre la vista previa, captura de nuevo y publica ese grupo una vez");

        assert.ok(peticionesSupabase.every(p => !/sorteos_programados|eventos_bot/.test(p)), "el panel no escribe en la base directamente");
        assert.deepStrictEqual(page.erroresJs, [], "sin errores de JavaScript en la página");
        paso("aislado: el panel solo usa la API /sorteos; sin errores de JS");

    } finally {
        await entorno.cerrar();
        fs.rmSync(DIR_CAPTURAS, { recursive: true, force: true });
    }

}

terminar(main());
