// ==========================================================================
// PRUEBA REAL DE CAPTURA — la imagen que publica un sorteo programado.
//
// Publica un sorteo programado con el publicador y las funciones REALES de
// «Compartir»: capturarImagenTabla abre Chromium (Puppeteer) en la página
// /tablas/imprimir/<precio> del panel (FRONTEND_URL) y captura la tabla. Se
// comprueba, por los colores de la imagen enviada, que es la tabla del
// sorteo (números libres/ocupados reales) con el diseño guardado EN EL
// SORTEO, no el diseño de Tablas del precio.
//
// Supabase y el socket de WhatsApp son simulados: no lee ni escribe datos
// reales y no envía nada. Solo carga la página pública del panel.
//
// Requisitos: Chromium de Puppeteer y un panel accesible.
//     FRONTEND_URL=https://<panel> node backend/tests/sorteos/capturaRealSorteo.test.js
// Sin FRONTEND_URL o sin Chromium se OMITE (no falla) y lo dice.
// ==========================================================================

process.env.GROUP_QUEUE_DELAY_MS = "0";

const assert = require("assert");
const path = require("path");
const { crearFake } = require("./fakeSupabaseSorteos");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);

const FRONTEND = process.env.FRONTEND_URL;

if (!FRONTEND) {
    console.log("⏭️  OMITIDA: define FRONTEND_URL (panel publicado o local) para la prueba real de captura.");
    process.exit(0);
}

let fake = crearFake();

require.cache[r("lib/supabase.js")] = {
    id: r("lib/supabase.js"), filename: r("lib/supabase.js"), loaded: true,
    exports: {
        from: (t) => fake.client.from(t),
        auth: { getUser: (t) => fake.client.auth.getUser(t) },
        rpc: async () => ({ data: null, error: { code: "PGRST202", message: "sin RPC en esta prueba" } })
    }
};

const puppeteer = require("puppeteer");
const servicio = require(r("sorteos/servicio.js"));
const publicador = require(r("sorteos/publicador.js"));
const { capturarImagenTabla, compartirEnGrupos } = require(r("services/compartirTabla.js"));
const { textoParaCompartir } = require(r("services/destinosCompartir.js"));
const { ejecutarUnaVez } = require(r("automation/executionGuard.js"));
const { guardarEvento } = require(r("bot/funciones/eventos/guardarEvento.js"));
const { consultarEventoDelSorteo } = require(r("bot/funciones/eventos/consultarEvento.js"));
const { abrirGrupo } = require(r("bot/funciones/eventos/grupos/abrirGrupo.js"));
const { actualizarEvento } = require(r("bot/funciones/reservas/actualizarEvento.js"));

const T0 = new Date("2026-10-15T15:00:00Z");
const PUBLICAR = new Date("2026-10-22T13:00:00Z");
servicio._reloj.ahora = () => T0;

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const T5K = "5k_15k_reservas_2_cifras";

// Colores inconfundibles: los del SORTEO y otros distintos para el diseño
// de Tablas del mismo precio (que NO debe aparecer en la imagen).
const diseno = (fondo, tabla, libre, reservado) => ({
    theme: { pageBg: fondo, tableBg: tabla, text: "#111111", border: "#222222", accent: "#333333" },
    cells: {
        available: { bg: libre, border: libre, text: "#000000" },
        reserved: { bg: reservado, border: reservado, text: "#FFFFFF" },
        pagado: { bg: reservado, border: reservado, text: "#FFFFFF" }
    },
    numbers: { size: 18, weight: 700 },
    grid: { radius: 4, spacing: 6, borderWidth: 1 }
});
const DEL_SORTEO = diseno("#1A2B6C", "#1A2B6C", "#F2E14C", "#D0207F");
const DE_TABLAS = diseno("#0B7A3E", "#0B7A3E", "#2FD5E8", "#FF7A00");

function escenario() {
    fake = crearFake();
    const t = fake.tablas;
    t.grupos_autorizados = [{ usuario_id: A, grupo_id: "g1@g.us", activo: true }];
    t.grupos = [{ jid: "g1@g.us", nombre: "Grupo 1" }];
    t.cuentas_pago = [{ id: "cuenta-a1", usuario_id: A, nombre: "Nequi A", tipo: "nequi", numero: "3000000001", titular: "A", activa: true }];
    t.eventos_bot = [];
    t.tabla_configuracion_visual = [{ usuario_id: A, precio: 3000, config: DE_TABLAS }];
    t[T5K] = Array.from({ length: 100 }, (_, i) => ({ numero: String(i).padStart(2, "0"), estado: "libre", usuario_id: A }));
}

// Cuenta píxeles cercanos a cada color, decodificando el PNG en Chromium.
async function contarColores(png, colores) {
    const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"] });
    try {
        const page = await browser.newPage();
        return await page.evaluate(async (src, objetivos) => {
            const img = new Image();
            await new Promise((ok, ko) => { img.onload = ok; img.onerror = ko; img.src = src; });
            const c = document.createElement("canvas");
            c.width = img.width; c.height = img.height;
            const ctx = c.getContext("2d");
            ctx.drawImage(img, 0, 0);
            const { data } = ctx.getImageData(0, 0, c.width, c.height);
            const rgb = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
            const metas = Object.fromEntries(Object.entries(objetivos).map(([k, h]) => [k, rgb(h)]));
            const cuenta = Object.fromEntries(Object.keys(objetivos).map(k => [k, 0]));
            for (let i = 0; i < data.length; i += 4) {
                for (const [k, [R, G, B]] of Object.entries(metas)) {
                    if (Math.abs(data[i] - R) <= 6 && Math.abs(data[i + 1] - G) <= 6 && Math.abs(data[i + 2] - B) <= 6) cuenta[k]++;
                }
            }
            return { ancho: img.width, alto: img.height, total: data.length / 4, cuenta };
        }, `data:image/png;base64,${png.toString("base64")}`, colores);
    } finally {
        await browser.close();
    }
}

(async () => {

    const silencio = async (fn) => {
        const { log, table, dir, warn } = console;
        console.log = console.table = console.dir = console.warn = () => {};
        try { return await fn(); } finally { Object.assign(console, { log, table, dir, warn }); }
    };

    escenario();

    const c = await silencio(() => servicio.crearSorteo(A, {
        modalidad: "dos_cifras", nombre: "Antioqueñita Día", hora_fin: "22:30", valor: 3000,
        premios: [{ nombre: "Premio mayor", premio: 300000 }], grupos: ["g1@g.us"], cuentas: ["cuenta-a1"],
        publicar_en: PUBLICAR.toISOString(), fecha_sorteo: "2026-10-22",
        mensajes: { publicacion: "", aviso_cierre: "" }, recordatorios: [],
        diseno: { origen: "preset", nombre: "Prueba", config: DEL_SORTEO }
    }));
    assert.ok(c.ok, JSON.stringify(c));
    const conf = await silencio(() => servicio.confirmar(A, c.data.id, { version: c.data.version, confirmacion: true }));
    assert.ok(conf.ok, JSON.stringify(conf));
    const s = conf.data;

    // 30 números ocupados de ESTE sorteo (reservas anticipadas).
    fake.tablas[T5K].slice(0, 30).forEach(f => Object.assign(f, { estado: "reservado", identidad_evento_real: s.identidad_evento_real }));

    const enviados = [];
    const capturas = [];
    let errorCaptura = null;
    const deps = {
        supabase: { from: (t) => fake.client.from(t) },
        guardarEvento, consultarEventoDelSorteo, abrirGrupo, ejecutarUnaVez, actualizarEvento,
        puedeActuar: () => true,
        capturarImagen: async (...args) => {
            try { const png = await capturarImagenTabla(...args); capturas.push(args); return png; }
            catch (e) { errorCaptura = e; throw e; }
        },
        textoParaCompartir,
        compartirEnGrupos,
        sendMessage: async () => { throw new Error("el anuncio nunca sale como texto"); }
    };
    const sock = {
        context: { usuarioId: A, sessionId: "ses-aaaa", telefono: "573000000000" },
        user: { id: "573000000000:1@s.whatsapp.net" },
        groupMetadata: async (jid) => ({ subject: `Nombre ${jid}`, participants: [] }),
        groupSettingUpdate: async () => {},
        sendMessage: async (jid, contenido) => { enviados.push({ jid, ...contenido }); return { key: { id: "m1" } }; }
    };

    const t0 = Date.now();
    await silencio(() => publicador.tick(sock, { ahora: new Date(PUBLICAR.getTime() + 60000), deps }));
    const segundos = ((Date.now() - t0) / 1000).toFixed(1);

    const grupo = fake.tablas.sorteos_programados_grupos.find(g => g.sorteo_id === s.id);

    if (errorCaptura && /launch|Chrome|browser|executable/i.test(errorCaptura.message)) {
        console.log(`⏭️  OMITIDA: Chromium no disponible en este entorno (${errorCaptura.message.split("\n")[0]}).`);
        assert.strictEqual(enviados.length, 0, "sin imagen no se envía nada");
        process.exit(0);
    }

    let ok = 0, fallos = 0;
    const comprobar = (nombre, fn) => {
        try { fn(); ok++; console.log(`✅ ${nombre}`); }
        catch (e) { fallos++; console.log(`❌ ${nombre}\n   ${e.message}`); }
    };

    comprobar(`captura real con ${FRONTEND} (${segundos} s) y publicación por «Compartir»`, () => {
        assert.strictEqual(errorCaptura, null, errorCaptura?.message);
        assert.strictEqual(grupo.estado, "publicado", grupo.ultimo_error);
        assert.strictEqual(enviados.length, 1);
        assert.ok(Buffer.isBuffer(enviados[0].image) && enviados[0].image.length > 1000, "una imagen PNG");
        assert.ok(enviados[0].caption.includes("Antioqueñita Día"), "con el anuncio como pie");
    });

    comprobar("captura pedida para el precio, el dueño y el evento del sorteo", () => {
        const [precio, usuarioId, eventoId] = capturas[0];
        const ev = fake.tablas.eventos_bot.find(e => e.id === eventoId);
        assert.deepStrictEqual([precio, usuarioId], [3000, A]);
        assert.strictEqual(ev.identidad_evento_real, s.identidad_evento_real);
        assert.strictEqual(ev.tabla, s.tabla);
    });

    if (enviados[0]?.image) {
        const px = await contarColores(enviados[0].image, {
            libreSorteo: "#F2E14C", ocupadoSorteo: "#D0207F", fondoSorteo: "#1A2B6C",
            libreTablas: "#2FD5E8", ocupadoTablas: "#FF7A00", fondoTablas: "#0B7A3E"
        });
        const { cuenta } = px;
        console.log(`   imagen ${px.ancho}x${px.alto}; píxeles: ${JSON.stringify(cuenta)}`);

        comprobar("diseño guardado en el sorteo (fondo y celdas), no el de Tablas del precio", () => {
            assert.ok(cuenta.fondoSorteo > px.total * 0.05, "fondo del sorteo");
            assert.ok(cuenta.libreSorteo > 0 && cuenta.ocupadoSorteo > 0, "celdas con los colores del sorteo");
            assert.strictEqual(cuenta.libreTablas + cuenta.ocupadoTablas + cuenta.fondoTablas, 0, "ningún color del diseño de Tablas");
        });

        comprobar("números de la tabla del sorteo: 70 libres y 30 ocupados (proporción de celdas)", () => {
            const proporcion = cuenta.libreSorteo / (cuenta.libreSorteo + cuenta.ocupadoSorteo);
            assert.ok(Math.abs(proporcion - 0.7) < 0.08, `libres/total por píxeles = ${proporcion.toFixed(3)}`);
        });
    }

    console.log("============================");
    console.log(`TOTAL: ${ok + fallos}  ✅ PASA: ${ok}  ❌ FALLA: ${fallos}`);
    console.log("============================");
    process.exit(fallos ? 1 : 0);

})().catch((e) => { console.error("❌ Error inesperado:", e); process.exit(1); });
