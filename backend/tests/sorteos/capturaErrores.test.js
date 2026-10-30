// ==========================================================================
// PRUEBAS — errores de la captura de la imagen (compartirTabla.
// capturarImagenTabla), la que publica sorteos programados e instantáneos.
//
// Causa del fallo de fotos en producción (23/10): el backend abre
// FRONTEND_URL/tablas/imprimir/<precio>; si esa URL es otra web (otro
// proyecto, un panel antiguo) la página carga pero nunca aparece la tabla
// («Waiting for selector [data-tabla-imprimir] failed»), y si no hay nada
// escuchando, «net::ERR_CONNECTION_REFUSED». El error ahora dice QUÉ panel
// se abrió (solo el host, que es público) para poder corregir FRONTEND_URL.
// También: los datos de la imagen de prueba se entregan a la página tal
// cual (opción `datos`), y el navegador se cierra siempre.
//
// Puppeteer y Supabase simulados: ninguna red. La captura real contra el
// panel publicado está en capturaRealSorteo.test.js.
//
//     node backend/tests/sorteos/capturaErrores.test.js
// ==========================================================================

process.env.FRONTEND_URL = "https://otro-panel.example.com";

const assert = require("assert");
const path = require("path");

const RAIZ = path.resolve(__dirname, "../..");
const inyectar = (rel, exp) => { const abs = path.join(RAIZ, rel); require.cache[abs] = { id: abs, filename: abs, loaded: true, exports: exp }; };

inyectar("lib/supabase.js", { from: () => { throw new Error("sin Supabase en esta prueba"); } });

const nav = { modo: "ok", cerrados: 0, recibido: null, evaluados: 0, capturasPropias: 0, devuelve: null };

// PNG mínimo con firma, IHDR y tamaño (lo que comprueba destinosCompartir.imagenPng).
function pngDe(ancho, alto) {
    const b = Buffer.alloc(40);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
    b.writeUInt32BE(13, 8); b.write("IHDR", 12, "ascii"); b.writeUInt32BE(ancho, 16); b.writeUInt32BE(alto, 20);
    return b;
}
const PNG_PANEL = pngDe(1408, 1408);
const DATA_URL_PANEL = `data:image/png;base64,${PNG_PANEL.toString("base64")}`;
const PUPPETEER = require.resolve("puppeteer", { paths: [RAIZ] });
require.cache[PUPPETEER] = {
    id: PUPPETEER, filename: PUPPETEER, loaded: true,
    exports: {
        launch: async () => {
            if (nav.modo === "sin_chromium") throw new Error("Failed to launch the browser process");
            let manejador = null;
            return {
                newPage: async () => ({
                    setViewport: async () => {},
                    setRequestInterception: async () => {},
                    on: (_ev, fn) => { manejador = fn; },
                    goto: async (url) => {
                        if (nav.modo === "rechazada") throw new Error(`net::ERR_CONNECTION_REFUSED at ${url}`);
                        // La página pide sus datos; el backend los entrega.
                        await new Promise(ok => manejador({
                            url: () => `${new URL(url).origin}/api/tablas/imprimir?precio=3000&token=directo`,
                            respond: ({ body }) => { nav.recibido = JSON.parse(body); ok(); },
                            continue: () => ok()
                        }));
                    },
                    waitForSelector: async () => {
                        if (nav.modo === "otra_web") throw new Error("Waiting for selector `[data-tabla-imprimir]` failed");
                        // Si alguien volviera a fotografiar el elemento, se cuenta.
                        return { screenshot: async () => { nav.capturasPropias++; return Buffer.from("PNG-propio"); } };
                    },
                    // window.__efaatCapturarTabla(): capturarTabla de «Compartir» en la página.
                    evaluate: async (fn) => {
                        nav.evaluados++;
                        assert.match(String(fn), /__efaatCapturarTabla()/);
                        return nav.devuelve ?? DATA_URL_PANEL;
                    },
                    screenshot: async () => { nav.capturasPropias++; return Buffer.from("PNG-propio"); }
                }),
                close: async () => { nav.cerrados++; }
            };
        }
    }
};

const { capturarImagenTabla } = require("../../services/compartirTabla");

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const DATOS = { numerosDisponibles: ["00", "01"], numerosOcupados: ["02"], cifras: 2, cantidad: 100, diseno: null };

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

prueba("1. Con datos dados (imagen de prueba): la página los recibe tal cual y se devuelve LA CAPTURA DEL PANEL (capturarTabla), sin foto propia", async () => {
    nav.modo = "ok"; nav.cerrados = 0; nav.recibido = null; nav.evaluados = 0; nav.capturasPropias = 0; nav.devuelve = null;
    const png = await capturarImagenTabla(3000, A, null, { datos: DATOS });
    assert.ok(png.equals(PNG_PANEL), "el PNG es el que devolvió la función del panel");
    assert.strictEqual(nav.evaluados, 1, "se ejecuta la captura de la página una vez");
    assert.strictEqual(nav.capturasPropias, 0, "el servidor no fotografía nada");
    assert.deepStrictEqual(nav.recibido, DATOS);
    assert.strictEqual(nav.cerrados, 1, "el navegador se cierra");
});

prueba("2. Otra web en FRONTEND_URL: el error dice qué panel se abrió y cómo corregirlo", async () => {
    nav.modo = "otra_web"; nav.cerrados = 0;
    await assert.rejects(() => capturarImagenTabla(3000, A, null, { datos: DATOS }), (err) => {
        assert.ok(/Waiting for selector/.test(err.message), err.message);
        assert.ok(/otro-panel\.example\.com/.test(err.message) && /FRONTEND_URL/.test(err.message), err.message);
        assert.ok(!/https:\/\//.test(err.message), "solo el host, sin la URL completa");
        return true;
    });
    assert.strictEqual(nav.cerrados, 1, "el navegador se cierra también si falla");
});

prueba("3. URL inaccesible (conexión rechazada): error con el panel, sin imagen", async () => {
    nav.modo = "rechazada"; nav.cerrados = 0;
    await assert.rejects(() => capturarImagenTabla(3000, A, null, { datos: DATOS }), /ERR_CONNECTION_REFUSED.*otro-panel\.example\.com/);
    assert.strictEqual(nav.cerrados, 1);
});

prueba("4. Chromium no arranca en el servidor: el error llega tal cual (no hay imagen)", async () => {
    nav.modo = "sin_chromium";
    await assert.rejects(() => capturarImagenTabla(3000, A, null, { datos: DATOS }), /Failed to launch the browser process/);
});

prueba("5. Sin dueño válido no se captura nada", async () => {
    nav.modo = "ok";
    await assert.rejects(() => capturarImagenTabla(3000, "no-es-uuid", null, { datos: DATOS }), /sin el dueño/);
});

prueba("6. La página devuelve algo que no es un PNG válido: error, ninguna imagen", async () => {
    nav.modo = "ok"; nav.cerrados = 0; nav.devuelve = "data:image/png;base64,QUJD";
    await assert.rejects(() => capturarImagenTabla(3000, A, null, { datos: DATOS }), /PNG válida/);
    assert.strictEqual(nav.cerrados, 1);
    nav.devuelve = null;
});

prueba("7. Sin FRONTEND_URL: error explícito y ni siquiera se abre Chromium (ya no hay localhost por defecto)", async () => {
    const antes = process.env.FRONTEND_URL;
    delete process.env.FRONTEND_URL;
    nav.modo = "sin_chromium";
    try {
        await assert.rejects(() => capturarImagenTabla(3000, A, null, { datos: DATOS }), /Falta FRONTEND_URL/);
    } finally { process.env.FRONTEND_URL = antes; nav.modo = "ok"; }
});

prueba("8. En producción, FRONTEND_URL con localhost se rechaza con un error explícito; fuera de producción se permite", async () => {
    const antes = { url: process.env.FRONTEND_URL, env: process.env.NODE_ENV };
    process.env.FRONTEND_URL = "http://localhost:3000";
    try {
        process.env.NODE_ENV = "production";
        nav.modo = "sin_chromium";
        await assert.rejects(() => capturarImagenTabla(3000, A, null, { datos: DATOS }), /localhost:3000.*producción/);
        process.env.NODE_ENV = "development";
        nav.modo = "ok"; nav.devuelve = null;
        const png = await capturarImagenTabla(3000, A, null, { datos: DATOS });
        assert.ok(png.equals(PNG_PANEL));
    } finally {
        process.env.FRONTEND_URL = antes.url;
        if (antes.env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = antes.env;
    }
});

(async () => {
    let ok = 0;
    for (const p of pruebas) {
        try { await p.fn(); ok++; console.log(`✅ ${p.n}`); }
        catch (e) { console.log(`❌ ${p.n}\n   ${e.message}`); }
    }
    console.log(`\n============================\nTOTAL: ${pruebas.length}  ✅ PASA: ${ok}  ❌ FALLA: ${pruebas.length - ok}\n============================`);
    process.exit(ok === pruebas.length ? 0 : 1);
})();
