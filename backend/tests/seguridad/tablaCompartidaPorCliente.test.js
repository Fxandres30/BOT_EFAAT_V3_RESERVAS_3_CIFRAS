// ==========================================================================
// PRUEBAS — la tabla que se comparte por WhatsApp (imagen de INITIAL_TABLE y
// botón "Compartir") muestra SOLO la cuadrícula del cliente dueño del sorteo.
//
// Antes: automation/repo/tablaEvento.obtenerNumeros leía la tabla física
// entera (la comparten todos los clientes, 100 filas por usuario_id) y el
// token de /tablas/imprimir-datos solo firmaba el precio: la imagen mezclaba
// los números de todos y cualquier token válido daba la tabla completa.
//
// Ruta HTTP real (routes/tablas.js), token real (services/compartirTabla.js)
// y repositorio real; Supabase es un doble en memoria.
//
//     node backend/tests/seguridad/tablaCompartidaPorCliente.test.js
// ==========================================================================

const assert = require("assert");
const path = require("path");
const http = require("http");

const { crearFake } = require("../sorteos/fakeSupabaseSorteos");

const RAIZ = path.resolve(__dirname, "../..");
function inyectar(rutaRel, exportsObj) {
    const abs = path.join(RAIZ, rutaRel);
    require.cache[abs] = { id: abs, filename: abs, loaded: true, exports: exportsObj };
}

process.env.TABLA_SHARE_SECRET = "secreto-de-prueba";
process.env.SESSIONS_API_TOKEN = "token-servicio-prueba";

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const TABLA = "5k_15k_reservas_2_cifras";

const fake = crearFake();
fake.tablas[TABLA] = [
    { numero: "00", estado: "libre", usuario_id: A },
    { numero: "01", estado: "reservado", usuario_id: A },
    { numero: "00", estado: "pagado", usuario_id: B },
    { numero: "01", estado: "libre", usuario_id: B },
    { numero: "02", estado: "reservado", usuario_id: null }
];
inyectar("lib/supabase.js", fake.client);

let capturas = 0;
inyectar("bot/funciones/eventos/configEvento.js", {
    obtenerConfiguracion: () => ({ tabla: TABLA, cifras: 2, cantidad: 100 }),
    // Configuración base del cliente (tablasCliente.js, sin tablas_cliente en el fake).
    configuracionesBase: () => [{ precio: 5000, tabla: TABLA, cifras: 2, cantidad: 100 }]
});
inyectar("services/baileys/send.js", { sendImage: async () => {} });
const PUPPETEER = require.resolve("puppeteer", { paths: [RAIZ] });
require.cache[PUPPETEER] = { id: PUPPETEER, filename: PUPPETEER, loaded: true, exports: { launch: async () => { capturas++; throw new Error("sin navegador en pruebas"); } } };

const tablaEvento = require("../../automation/repo/tablaEvento");
const compartir = require("../../services/compartirTabla");

const express = require("express");
const app = express();
app.use(express.json());
app.use("/tablas", require("../../routes/tablas"));

let base;
function get(camino) {
    return new Promise((resolve, reject) => {
        http.get(base + camino, res => {
            let d = ""; res.on("data", c => { d += c; });
            res.on("end", () => resolve({ status: res.statusCode, json: JSON.parse(d || "null") }));
        }).on("error", reject);
    });
}

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

prueba("obtenerNumeros sin dueño -> vacío (falla cerrado, nunca la tabla mezclada)", async () => {
    assert.deepStrictEqual(await tablaEvento.obtenerNumeros(TABLA), { numerosDisponibles: [], numerosOcupados: [] });
    assert.deepStrictEqual(await tablaEvento.obtenerNumeros(TABLA, null), { numerosDisponibles: [], numerosOcupados: [] });
});

prueba("obtenerNumeros(tabla, A) -> solo la cuadrícula de A; (tabla, B) -> solo la de B", async () => {
    assert.deepStrictEqual(await tablaEvento.obtenerNumeros(TABLA, A), { numerosDisponibles: ["00"], numerosOcupados: ["01"] });
    assert.deepStrictEqual(await tablaEvento.obtenerNumeros(TABLA, B), { numerosDisponibles: ["01"], numerosOcupados: ["00"] });
});

prueba("/tablas/imprimir-datos con token de A -> solo los números de A", async () => {
    const { token } = compartir.generarTokenImprimir(5000, A);
    const r = await get(`/tablas/imprimir-datos?precio=5000&token=${encodeURIComponent(token)}`);
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual([r.json.numerosDisponibles, r.json.numerosOcupados], [["00"], ["01"]]);
});

prueba("token de A con el usuario cambiado a B (misma firma) -> 401", async () => {
    const { token } = compartir.generarTokenImprimir(5000, A);
    const [expira, , firma] = token.split(".");
    const r = await get(`/tablas/imprimir-datos?precio=5000&token=${encodeURIComponent(`${expira}.${B}.${firma}`)}`);
    assert.strictEqual(r.status, 401);
});

prueba("token del formato anterior (solo precio) o de otro precio -> 401", async () => {
    const crypto = require("crypto");
    const expira = Date.now() + 60000;
    const viejo = `${expira}.${crypto.createHmac("sha256", process.env.TABLA_SHARE_SECRET).update(`5000.${expira}`).digest("hex")}`;
    assert.strictEqual((await get(`/tablas/imprimir-datos?precio=5000&token=${encodeURIComponent(viejo)}`)).status, 401);
    const { token } = compartir.generarTokenImprimir(5000, A);
    assert.strictEqual((await get(`/tablas/imprimir-datos?precio=10000&token=${encodeURIComponent(token)}`)).status, 401);
    assert.strictEqual((await get("/tablas/imprimir-datos?precio=5000")).status, 401);
});

prueba("no se genera enlace de impresión sin dueño válido", async () => {
    assert.throws(() => compartir.generarTokenImprimir(5000, null));
    assert.throws(() => compartir.generarTokenImprimir(5000, "x.y"));
});

// ---- Estilo por sorteo (2026-10-21): la imagen usa el estilo guardado en
// el sorteo programado del evento firmado, nunca el de otro cliente, y el
// diseño global de la tabla del precio no se toca al publicar.
function estilo(acento) {
    const celda = { bg: "#ffffff", border: "#000000", text: "#111111" };
    return { theme: { pageBg: "#ffffff", tableBg: "#ffffff", text: "#000000", border: "#000000", accent: acento },
        cells: { available: celda, reserved: celda, pagado: celda }, numbers: { size: 20, weight: 700 }, grid: { radius: 4, spacing: 4, borderWidth: 1 } };
}
fake.tablas.tabla_configuracion_visual = [{ usuario_id: A, precio: 5000, config: estilo("#aaaaaa") }, { usuario_id: B, precio: 5000, config: estilo("#bbbbbb") }];
fake.tablas.eventos_bot = [{ id: "101", usuario_id: A, identidad_evento_real: "ida" }, { id: "202", usuario_id: B, identidad_evento_real: "idb" }, { id: "303", usuario_id: A, identidad_evento_real: "manual" }];
fake.tablas.sorteos_programados = [
    { usuario_id: A, identidad_evento_real: "ida", creado_en: "2026-10-20T10:00:00Z", config: { diseno: { origen: "preset", config: estilo("#a1a1a1") } } },
    { usuario_id: B, identidad_evento_real: "idb", creado_en: "2026-10-20T10:00:00Z", config: { diseno: { origen: "preset", config: estilo("#b1b1b1") } } },
    // Mismo identificador en otro cliente: nunca debe usarse para A.
    { usuario_id: B, identidad_evento_real: "ida", creado_en: "2026-10-21T10:00:00Z", config: { diseno: { origen: "preset", config: estilo("#b2b2b2") } } }
];
const acentoDe = r => r.json?.diseno?.theme?.accent;

prueba("token sin evento -> diseño de la tabla del precio de ese cliente", async () => {
    const { token } = compartir.generarTokenImprimir(5000, A);
    assert.strictEqual(acentoDe(await get(`/tablas/imprimir-datos?precio=5000&token=${encodeURIComponent(token)}`)), "#aaaaaa");
});

prueba("token con evento de A -> estilo guardado en SU sorteo (no el de B con la misma identidad)", async () => {
    const { token } = compartir.generarTokenImprimir(5000, A, "101");
    assert.strictEqual(token.split(".").length, 4);
    const r = await get(`/tablas/imprimir-datos?precio=5000&token=${encodeURIComponent(token)}`);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(acentoDe(r), "#a1a1a1");
    assert.deepStrictEqual([r.json.numerosDisponibles, r.json.numerosOcupados], [["00"], ["01"]]);
});

prueba("token de A firmado con el evento de B -> nunca el estilo de B (cae al diseño propio de A)", async () => {
    const { token } = compartir.generarTokenImprimir(5000, A, "202");
    assert.strictEqual(acentoDe(await get(`/tablas/imprimir-datos?precio=5000&token=${encodeURIComponent(token)}`)), "#aaaaaa");
});

prueba("evento cambiado en el token (misma firma) -> 401", async () => {
    const { token } = compartir.generarTokenImprimir(5000, A, "101");
    const [expira, usuario, , firma] = token.split(".");
    assert.strictEqual((await get(`/tablas/imprimir-datos?precio=5000&token=${encodeURIComponent(`${expira}.${usuario}.303.${firma}`)}`)).status, 401);
    assert.strictEqual((await get(`/tablas/imprimir-datos?precio=5000&token=${encodeURIComponent(`${expira}.${usuario}.${firma}`)}`)).status, 401);
});

prueba("evento sin sorteo programado -> diseño de la tabla del precio", async () => {
    const { token } = compartir.generarTokenImprimir(5000, A, "303");
    assert.strictEqual(acentoDe(await get(`/tablas/imprimir-datos?precio=5000&token=${encodeURIComponent(token)}`)), "#aaaaaa");
});

prueba("leer la imagen nunca modifica tabla_configuracion_visual", async () => {
    assert.deepStrictEqual(fake.tablas.tabla_configuracion_visual.map(f => f.config.theme.accent), ["#aaaaaa", "#bbbbbb"]);
});

prueba("compartirTabla con un evento sin dueño -> no publica nada (evento_sin_propietario)", async () => {
    const antes = capturas;
    const r = await compartir.compartirTabla({ evento: { grupo_id: "g@g.us", valor: 5000, usuario_id: null } });
    assert.deepStrictEqual(r, { enviado: false, motivo: "evento_sin_propietario" });
    assert.strictEqual(capturas, antes, "ni siquiera abre el navegador");
});

(async () => {
    const server = http.createServer(app);
    await new Promise(r => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${server.address().port}`;
    const err = console.error;
    let ok = 0, falla = 0;
    for (const { n, fn } of pruebas) {
        console.error = () => {};
        try { await fn(); console.error = err; ok++; console.log(`✅ ${n}`); }
        catch (e) { console.error = err; falla++; console.log(`❌ ${n}`); console.log(String(e && e.stack || e)); }
    }
    server.close();
    console.log(`\n============================\nTOTAL: ${ok + falla}  ✅ PASA: ${ok}  ❌ FALLA: ${falla}\n============================`);
    process.exit(falla ? 1 : 0);
})();
