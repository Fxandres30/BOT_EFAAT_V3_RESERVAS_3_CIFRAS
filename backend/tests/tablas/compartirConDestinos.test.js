// ==========================================================================
// PRUEBAS — botón «Compartir» de Tablas con grupos de destino elegidos y
// guardados: vista previa (sin enviar), caption, primera selección,
// persistencia, envío de un clic, duplicados y aislamiento entre clientes.
//
// Ruta HTTP REAL (routes/tablas.js + exigirUsuario), servicios reales
// (compartirTabla, destinosCompartir, sorteosActivos, executionGuard);
// Supabase en memoria, navegador y WhatsApp SIMULADOS: ningún envío real.
//
// La imagen de «Compartir» la captura el PANEL (el `div` de la tabla
// visible) y llega en el cuerpo como PNG: el backend solo la valida y la
// envía. Puppeteer (simulado aquí) ya solo lo usa la tabla inicial del
// scheduler y el formato antiguo sin solicitudId.
//
//     node backend/tests/tablas/compartirConDestinos.test.js
// ==========================================================================

const assert = require("assert");
const path = require("path");
const http = require("http");
const express = require("express");

const { crearFake } = require("../sorteos/fakeSupabaseSorteos");

// Sin TABLA_SHARE_SECRET a propósito: la captura ya no usa enlaces firmados.
delete process.env.TABLA_SHARE_SECRET;
process.env.SESSIONS_API_TOKEN = "token-servicio-compartir";
// Panel que abre el Chromium simulado (ya no hay localhost por defecto).
process.env.FRONTEND_URL = "http://127.0.0.1:3999";

const RAIZ = path.resolve(__dirname, "../..");
function inyectar(rutaRel, exportsObj) {
    const abs = path.join(RAIZ, rutaRel);
    require.cache[abs] = { id: abs, filename: abs, loaded: true, exports: exportsObj };
}

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const T5K = "5k_15k_reservas_2_cifras";
const EV_A = "e0000000-0000-4000-8000-0000000000a1";
const EV_B = "e0000000-0000-4000-8000-0000000000b1";

let fake = crearFake();
inyectar("lib/supabase.js", { from: (t) => fake.client.from(t), auth: { getUser: (t) => fake.client.auth.getUser(t) } });

inyectar("bot/funciones/eventos/configEvento.js", {
    obtenerConfiguracion: () => ({ tabla: T5K, cifras: 2, cantidad: 100 }),
    configuracionesBase: () => [{ precio: 5000, tabla: T5K, cifras: 2, cantidad: 100 }]
});

// WhatsApp simulado: registra cada envío; `fallarEn` y `retardoMs` simulan
// un grupo que rechaza y un envío lento.
const envios = [];
const sim = { fallarEn: new Set(), retardoMs: 0 };
inyectar("services/baileys/send.js", {
    sendImage: async ({ sock, jid, image, caption }) => {
        if (sim.retardoMs) await new Promise(r => setTimeout(r, sim.retardoMs));
        if (sim.fallarEn.has(jid)) throw new Error("not-authorized");
        envios.push({ usuario: sock.usuario, jid, image: image.toString("base64"), caption });
    },
    sendMessage: async () => { throw new Error("no debe enviarse texto suelto"); }
});
const sockets = new Map();
inyectar("services/baileys/manager.js", { getSocketActivoDe: (u) => sockets.get(u) || null });

// Navegador simulado que hace lo mismo que la página real de impresión: al
// cargar pide sus datos a /api/tablas/imprimir y pinta lo que recibe. Si la
// petición no se intercepta (llegaría al backend sin token válido), no hay
// imagen. La "imagen" es la ruta de la página + los datos recibidos.
let capturas = 0;
const nav = { fallar: false, sinInterceptar: false };
// Cabecera PNG válida (firma + IHDR) + la descripción de lo pintado: lo que
// devuelve capturarTabla en la página pasa por destinosCompartir.imagenPng.
const CABECERA_PNG = (() => {
    const b = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
    b.writeUInt32BE(13, 8); b.write("IHDR", 12, "ascii"); b.writeUInt32BE(1408, 16); b.writeUInt32BE(1408, 20);
    return b;
})();
const pngPintado = (texto) => Buffer.concat([CABECERA_PNG, Buffer.from(texto)]);
const PUPPETEER = require.resolve("puppeteer", { paths: [RAIZ] });
require.cache[PUPPETEER] = {
    id: PUPPETEER, filename: PUPPETEER, loaded: true,
    exports: {
        launch: async () => {
            capturas++;
            let url = "";
            let interceptar = false;
            let manejador = null;
            let pintado = null;
            return {
                newPage: async () => ({
                    setViewport: async () => {},
                    setRequestInterception: async (v) => { interceptar = v; },
                    on: (ev, fn) => { if (ev === "request") manejador = fn; },
                    goto: async (u) => {
                        if (nav.fallar) throw new Error("timeout");
                        url = u;
                        const origen = new URL(u).origin;
                        const precio = new URL(u).pathname.split("/").pop();
                        await new Promise((ok) => {
                            const req = {
                                url: () => `${origen}/api/tablas/imprimir?precio=${precio}&token=directo`,
                                respond: ({ body }) => { pintado = JSON.parse(body); ok(); },
                                continue: () => ok()
                            };
                            if (interceptar && manejador && !nav.sinInterceptar) manejador(req); else req.continue();
                        });
                    },
                    waitForSelector: async () => {
                        if (!pintado) throw new Error("la página no recibió datos");
                        return {};
                    },
                    // window.__efaatCapturarTabla(): capturarTabla en la página.
                    evaluate: async () => `data:image/png;base64,${pngPintado(`PNG ${new URL(url).pathname} ocupados=${pintado.numerosOcupados.join(",")}`).toString("base64")}`
                }),
                close: async () => {}
            };
        }
    }
};

const app = express();
// Igual que server.js: límite propio para la captura PNG, antes del global.
app.use("/tablas/compartir", express.json({ limit: "6mb" }));
app.use(express.json());
app.use("/tablas", require("../../routes/tablas"));

function escenario() {
    fake = crearFake();
    const t = fake.tablas;
    fake.tokens["jwt-A"] = A;
    fake.tokens["jwt-B"] = B;
    envios.length = 0;
    sim.fallarEn = new Set();
    sim.retardoMs = 0;
    nav.fallar = false;
    sockets.clear();
    sockets.set(A, { usuario: A });
    sockets.set(B, { usuario: B });
    t.grupos_autorizados = [
        { usuario_id: A, grupo_id: "g1@g.us", activo: true },
        { usuario_id: A, grupo_id: "g2@g.us", activo: true },
        { usuario_id: A, grupo_id: "g3@g.us", activo: false },
        { usuario_id: B, grupo_id: "gb@g.us", activo: true }
    ];
    t.grupos = [{ jid: "g1@g.us", nombre: "Rifa uno" }, { jid: "g2@g.us", nombre: "Rifa dos" }, { jid: "gb@g.us", nombre: "Grupo de B" }];
    const ev = (id, u, grupo, nombre) => ({
        id, usuario_id: u, grupo_id: grupo, activo: true, abierto: true, estado: "abierto", identidad_evento_real: `ident-${u.slice(0, 1)}`,
        nombre_evento: nombre, hora_fin: "22:30", hora_cierre: "22:26", fecha_evento: "2026-10-22", valor: 5000,
        premios: [{ tipo: "otro", nombre: "Mayor", premio: 100000 }], tabla: T5K, cifras: 2, cantidad_numeros: 100, creado_en: "2026-10-22T12:00:00Z"
    });
    t.eventos_bot = [ev(EV_A, A, "g1@g.us", "Chontico Noche"), ev(EV_B, B, "gb@g.us", "Secreto de B")];
    t[T5K] = [A, B].flatMap(u => Array.from({ length: 100 }, (_, i) => ({ numero: String(i).padStart(2, "0"), estado: i < (u === A ? 3 : 5) ? "pagado" : "libre", usuario_id: u })));
}

let base;
const h = (jwt) => ({ "content-type": "application/json", "x-service-token": "token-servicio-compartir", authorization: `Bearer ${jwt}` });
// PNG real de 1x1 (lo que manda el panel tras capturar el `div` de la tabla).
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const PNG_DATA_URL = `data:image/png;base64,${PNG_B64}`;
// Los envíos nuevos (con solicitudId) llevan la captura salvo que la prueba
// mande su propia `imagen` (incluso inválida o ausente con imagen: undefined).
const llamar = async (metodo, camino, cuerpo, jwt = "jwt-A") => {
    if (metodo === "POST" && camino === "/tablas/compartir" && cuerpo?.solicitudId !== undefined && !("imagen" in cuerpo)) cuerpo = { ...cuerpo, imagen: PNG_DATA_URL };
    const res = await fetch(base + camino, { method: metodo, headers: h(jwt), ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}) });
    return { status: res.status, json: await res.json() };
};
let n = 0;
const sol = () => `00000000-0000-4000-9000-${String(++n).padStart(12, "0")}`;
const destinosDe = (u) => (fake.tablas.destinos_compartir_tabla || []).filter(d => d.usuario_id === u);
// Lo que compartir NUNCA debe tocar (reservas, pagos, números, eventos...).
const intocable = () => JSON.stringify({ [T5K]: fake.tablas[T5K], eventos_bot: fake.tablas.eventos_bot, grupos_autorizados: fake.tablas.grupos_autorizados, sorteos_programados: fake.tablas.sorteos_programados || null });
// Primera diferencia (tabla + fila) entre dos instantáneas de intocable().
function diferencia(antes, despues) {
    const a = JSON.parse(antes), d = JSON.parse(despues);
    for (const t of Object.keys(a)) {
        const fa = a[t] || [], fd = d[t] || [];
        if (fa.length !== fd.length) return `${t}: ${fa.length} -> ${fd.length} filas`;
        for (let i = 0; i < fa.length; i++) if (JSON.stringify(fa[i]) !== JSON.stringify(fd[i])) return `${t}[${i}]: ${JSON.stringify(fa[i])} -> ${JSON.stringify(fd[i])}`;
    }
    return null;
}

// Lo que pinta el Puppeteer simulado (solo scheduler / formato antiguo).
const IMG_PUPPETEER_A = pngPintado("PNG /tablas/imprimir/5000 ocupados=00,01,02").toString("base64");

const pruebas = [];
const prueba = (nombre, fn) => pruebas.push({ nombre, fn });

prueba("1. Vista previa (panel actual, sin_imagen=1): texto y SUS grupos; ni genera imagen ni envía nada", async () => {
    escenario();
    const capturasAntes = capturas;
    const r = await llamar("GET", "/tablas/compartir/vista-previa?precio=5000&sin_imagen=1");
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    const v = r.json.data;
    assert.ok(!("imagen" in v), "la imagen no sale del backend");
    assert.strictEqual(capturas, capturasAntes, "sin Puppeteer");
    assert.ok(v.texto.includes("Chontico Noche"), v.texto);
    assert.strictEqual(v.origen_texto, "habitual");
    assert.deepStrictEqual(v.grupos.map(g => [g.grupo_id, g.nombre]), [["g1@g.us", "Rifa uno"], ["g2@g.us", "Rifa dos"]], "solo autorizados y activos de A");
    assert.deepStrictEqual([v.seleccion, v.persistencia, v.sesion_conectada], [[], true, true]);
    assert.strictEqual(envios.length, 0, "cargar la vista previa no envía");
    assert.strictEqual((fake.tablas.automation_actions || []).length, 0);
});

prueba("2. Texto configurado: el «Mensaje de publicación» del sorteo activo, con sus variables", async () => {
    escenario();
    fake.tablas.eventos_bot[0].publicacion_panel = { identidad: "ident-a", texto: "🎉 {{nombre}} a las {{hora}}" };
    const v = (await llamar("GET", "/tablas/compartir/vista-previa?precio=5000")).json.data;
    assert.strictEqual(v.origen_texto, "sorteo");
    assert.strictEqual(v.texto, "🎉 Chontico Noche a las 10:30 PM");
});

prueba("3. Primer clic sin grupos guardados: pide elegirlos (409 sin_destinos), nada enviado", async () => {
    escenario();
    const r = await llamar("POST", "/tablas/compartir", { precio: 5000, solicitudId: sol() });
    assert.strictEqual(r.status, 409);
    assert.strictEqual(r.json.motivo, "sin_destinos");
    assert.strictEqual(envios.length, 0);
});

prueba("4. Selección inicial confirmada: imagen + caption en el MISMO mensaje a cada grupo y selección guardada", async () => {
    escenario();
    const antes = intocable();
    const r = await llamar("POST", "/tablas/compartir", { precio: 5000, solicitudId: sol(), grupos: ["g1@g.us", "g2@g.us"], texto: "  Texto editado  ", guardar_destinos: true });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.deepStrictEqual([r.json.enviado, r.json.enviados, r.json.fallidos], [true, 2, 0]);
    assert.deepStrictEqual(envios.map(e => [e.jid, e.caption, e.usuario]), [["g1@g.us", "Texto editado", A], ["g2@g.us", "Texto editado", A]]);
    assert.ok(envios.every(e => e.image === PNG_B64), "se envía EXACTAMENTE la captura recibida del panel");
    assert.deepStrictEqual(destinosDe(A).map(d => [d.precio, d.grupos]), [[5000, ["g1@g.us", "g2@g.us"]]]);
    assert.strictEqual(diferencia(antes, intocable()), null, "reservas, pagos, números y sorteo intactos");
});

prueba("5. Siguientes clics: sin volver a elegir, a los grupos guardados con el texto configurado", async () => {
    escenario();
    await llamar("POST", "/tablas/compartir", { precio: 5000, solicitudId: sol(), grupos: ["g2@g.us"], texto: "Solo esta vez", guardar_destinos: true });
    envios.length = 0;
    const capturasAntes = capturas;
    const r = await llamar("POST", "/tablas/compartir", { precio: 5000, solicitudId: sol() });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.deepStrictEqual(envios.map(e => e.jid), ["g2@g.us"]);
    assert.ok(envios[0].caption.includes("Chontico Noche") && !envios[0].caption.includes("Solo esta vez"), "texto configurado, no el editado antes");
    assert.strictEqual(envios[0].image, PNG_B64, "la captura de ESTE clic");
    assert.strictEqual(capturas, capturasAntes, "sin Puppeteer");
    assert.strictEqual((await llamar("GET", "/tablas/compartir/vista-previa?precio=5000")).json.data.seleccion.join(), "g2@g.us");
});

prueba("6. Sin duplicados: misma solicitud repetida no reenvía; dos a la vez -> una rechazada", async () => {
    escenario();
    const id = sol();
    const cuerpo = { precio: 5000, solicitudId: id, grupos: ["g1@g.us"], guardar_destinos: true };
    await llamar("POST", "/tablas/compartir", cuerpo);
    const repetida = await llamar("POST", "/tablas/compartir", cuerpo);
    assert.strictEqual(repetida.json.resultados[0].estado, "ya_enviado");
    assert.strictEqual(envios.length, 1, "un solo envío real");
    sim.retardoMs = 150;
    const [x, y] = await Promise.all([
        llamar("POST", "/tablas/compartir", { precio: 5000, solicitudId: sol() }),
        llamar("POST", "/tablas/compartir", { precio: 5000, solicitudId: sol() })
    ]);
    assert.deepStrictEqual([x.status, y.status].sort(), [200, 409]);
    assert.strictEqual([x, y].find(r => r.status === 409).json.motivo, "envio_en_curso");
    assert.strictEqual(envios.length, 2);
});

prueba("7. Aislamiento: selecciones por cliente; A no puede enviar a un grupo de B; B no ve ni usa lo de A", async () => {
    escenario();
    await llamar("POST", "/tablas/compartir", { precio: 5000, solicitudId: sol(), grupos: ["g1@g.us"], guardar_destinos: true });
    const ajeno = await llamar("POST", "/tablas/compartir", { precio: 5000, solicitudId: sol(), grupos: ["gb@g.us"], guardar_destinos: true });
    assert.strictEqual(ajeno.status, 409);
    assert.deepStrictEqual(ajeno.json.invalidos, ["gb@g.us"]);
    assert.strictEqual((await llamar("PUT", "/tablas/compartir/destinos", { precio: 5000, grupos: ["gb@g.us"] })).status, 409);
    const deB = await llamar("POST", "/tablas/compartir", { precio: 5000, solicitudId: sol(), usuarioId: A }, "jwt-B");
    assert.strictEqual(deB.json.motivo, "sin_destinos", "el usuarioId del cuerpo se ignora");
    const vB = (await llamar("GET", "/tablas/compartir/vista-previa?precio=5000", null, "jwt-B")).json.data;
    assert.deepStrictEqual([vB.grupos.map(g => g.grupo_id), vB.seleccion], [["gb@g.us"], []]);
    assert.ok(!vB.texto.includes("Chontico") && vB.texto.includes("Secreto de B"));
    await llamar("POST", "/tablas/compartir", { precio: 5000, solicitudId: sol(), grupos: ["gb@g.us"], guardar_destinos: true }, "jwt-B");
    assert.deepStrictEqual(envios.map(e => [e.usuario, e.jid]), [[A, "g1@g.us"], [B, "gb@g.us"]], "cada uno con SU WhatsApp y SUS grupos");
    assert.deepStrictEqual([destinosDe(A)[0].grupos, destinosDe(B)[0].grupos], [["g1@g.us"], ["gb@g.us"]]);
});

prueba("8. Destinos que ya no están disponibles o sesión desconectada: error claro, nunca un envío fingido", async () => {
    escenario();
    await llamar("PUT", "/tablas/compartir/destinos", { precio: 5000, grupos: ["g1@g.us", "g2@g.us"] });
    fake.tablas.grupos_autorizados.find(g => g.grupo_id === "g2@g.us").activo = false;
    const r = await llamar("POST", "/tablas/compartir", { precio: 5000, solicitudId: sol() });
    assert.deepStrictEqual([r.status, r.json.motivo, r.json.invalidos], [409, "destinos_no_disponibles", ["g2@g.us"]]);
    const v = (await llamar("GET", "/tablas/compartir/vista-previa?precio=5000")).json.data;
    assert.deepStrictEqual([v.seleccion, v.invalidos], [["g1@g.us"], ["g2@g.us"]]);
    sockets.delete(A);
    const sinSesion = await llamar("POST", "/tablas/compartir", { precio: 5000, solicitudId: sol(), grupos: ["g1@g.us"] });
    assert.deepStrictEqual([sinSesion.status, sinSesion.json.enviado, sinSesion.json.motivo], [409, false, "sin_sesion_activa"]);
    assert.strictEqual(envios.length, 0);
    assert.strictEqual((await llamar("GET", "/tablas/compartir/vista-previa?precio=5000")).json.data.sesion_conectada, false);
});

prueba("9. Resultado por grupo: uno falla y se informa", async () => {
    escenario();
    sim.fallarEn.add("g2@g.us");
    const r = await llamar("POST", "/tablas/compartir", { precio: 5000, solicitudId: sol(), grupos: ["g1@g.us", "g2@g.us"] });
    assert.deepStrictEqual([r.json.enviado, r.json.enviados, r.json.fallidos], [true, 1, 1]);
    assert.deepStrictEqual(r.json.resultados.map(x => [x.grupo_id, x.estado]), [["g1@g.us", "enviado"], ["g2@g.us", "fallido"]]);
    assert.ok(/not-authorized/.test(r.json.resultados[1].error));
});

prueba("10. Migración 037 sin aplicar: se envía a lo elegido y se avisa; el siguiente clic vuelve a pedir grupos", async () => {
    escenario();
    fake.control.tablasInexistentes.add("destinos_compartir_tabla");
    assert.strictEqual((await llamar("GET", "/tablas/compartir/vista-previa?precio=5000")).json.data.persistencia, false);
    const r = await llamar("POST", "/tablas/compartir", { precio: 5000, solicitudId: sol(), grupos: ["g1@g.us"], guardar_destinos: true });
    assert.strictEqual(r.status, 200);
    assert.ok(/no se puede guardar/.test(r.json.aviso));
    const otra = await llamar("POST", "/tablas/compartir", { precio: 5000, solicitudId: sol() });
    assert.deepStrictEqual([otra.json.motivo, otra.json.persistencia], ["sin_destinos", false]);
    assert.strictEqual((await llamar("PUT", "/tablas/compartir/destinos", { precio: 5000, grupos: ["g1@g.us"] })).status, 503);
    assert.strictEqual(envios.length, 1);
});

prueba("11. Validación: grupos vacíos o con formato inválido y solicitud sin id -> 400 sin enviar", async () => {
    escenario();
    for (const grupos of [[], ["no-es-grupo"], "g1@g.us"]) {
        assert.strictEqual((await llamar("POST", "/tablas/compartir", { precio: 5000, solicitudId: sol(), grupos })).status, 400, JSON.stringify(grupos));
    }
    assert.strictEqual((await llamar("POST", "/tablas/compartir", { precio: 5000, solicitudId: "x" })).status, 400);
    assert.strictEqual(envios.length, 0);
});

prueba("12. Compatibilidad: el panel anterior (sin solicitudId) sigue publicando en el grupo del evento", async () => {
    escenario();
    const r = await llamar("POST", "/tablas/compartir", { precio: 5000 });
    assert.deepStrictEqual([r.status, r.json.enviado], [200, true]);
    assert.deepStrictEqual(envios.map(e => [e.jid, e.image]), [["g1@g.us", IMG_PUPPETEER_A]], "formato antiguo: imagen del generador anterior");
});

prueba("13. Envío: la captura del panel va como FOTO con el texto como caption, sin Puppeteer ni secreto", async () => {
    escenario();
    assert.strictEqual(process.env.TABLA_SHARE_SECRET, undefined, "el secreto no está en el entorno");
    const capturasAntes = capturas;
    const r = await llamar("POST", "/tablas/compartir", { precio: 5000, solicitudId: sol(), grupos: ["g1@g.us"], texto: "Caption de prueba" });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.deepStrictEqual(envios.map(e => [e.jid, e.image, e.caption]), [["g1@g.us", PNG_B64, "Caption de prueba"]], "foto + caption en el mismo envío");
    assert.strictEqual(capturas, capturasAntes, "Compartir no abre ningún navegador");
});

prueba("14. Imagen presente pero inválida o demasiado grande: 400 imagen_invalida, sin Puppeteer y sin envío", async () => {
    escenario();
    const png = Buffer.from(PNG_B64, "base64");
    const conLado = (ancho) => { const b = Buffer.from(png); b.writeUInt32BE(ancho, 16); return `data:image/png;base64,${b.toString("base64")}`; };
    const grande = Buffer.concat([png, Buffer.alloc(3 * 1024 * 1024)]);
    const casos = {
        no_png: `data:image/jpeg;base64,${PNG_B64}`,
        no_data_url: PNG_B64,
        firma_falsa: `data:image/png;base64,${Buffer.from("no soy un png, solo texto largo para pasar el minimo").toString("base64")}`,
        base64_roto: "data:image/png;base64,@@@@",
        lado_enorme: conLado(9000),
        demasiado_grande: `data:image/png;base64,${grande.toString("base64")}`
    };
    casos.nula = null;
    const capturasAntes = capturas;
    for (const [caso, imagen] of Object.entries(casos)) {
        const r = await llamar("POST", "/tablas/compartir", { precio: 5000, solicitudId: sol(), grupos: ["g1@g.us"], imagen });
        assert.deepStrictEqual([r.status, r.json.motivo], [400, "imagen_invalida"], caso);
    }
    assert.strictEqual(envios.length, 0);
    assert.strictEqual(capturas, capturasAntes, "una imagen inválida nunca cae al flujo de Puppeteer");
    assert.strictEqual((fake.tablas.automation_actions || []).length, 0, "ni siquiera se registra un intento");
});

prueba("15. La tabla inicial automática del scheduler (compartirTabla) no cambia", async () => {
    escenario();
    const { compartirTabla } = require("../../services/compartirTabla");
    const s = await compartirTabla({ evento: fake.tablas.eventos_bot[0], sock: sockets.get(A) });
    assert.deepStrictEqual(s, { enviado: true });
    assert.deepStrictEqual(envios.map(e => [e.jid, e.image]), [["g1@g.us", IMG_PUPPETEER_A]]);
});

// ------------------------------- compatibilidad con el panel publicado ---

prueba("16. Panel publicado (solicitudId SIN imagen): se acepta y la imagen sale del flujo anterior (Puppeteer)", async () => {
    escenario();
    const capturasAntes = capturas;
    const r = await llamar("POST", "/tablas/compartir", { precio: 5000, solicitudId: sol(), grupos: ["g1@g.us"], texto: "Caption antiguo", guardar_destinos: true, imagen: undefined });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.strictEqual(capturas, capturasAntes + 1, "una captura con Puppeteer");
    assert.deepStrictEqual(envios.map(e => [e.jid, e.image, e.caption]), [["g1@g.us", IMG_PUPPETEER_A, "Caption antiguo"]]);
    assert.deepStrictEqual(destinosDe(A).map(d => d.grupos), [["g1@g.us"]]);
    // Un clic posterior del panel publicado (grupos guardados, sin imagen).
    const r2 = await llamar("POST", "/tablas/compartir", { precio: 5000, solicitudId: sol(), imagen: undefined });
    assert.strictEqual(r2.status, 200, JSON.stringify(r2.json));
    assert.strictEqual(envios.length, 2);
});

prueba("17. Panel publicado: mismas validaciones (grupos ajenos, sesión, duplicados) y la captura solo tras pasarlas", async () => {
    escenario();
    const capturasAntes = capturas;
    const ajeno = await llamar("POST", "/tablas/compartir", { precio: 5000, solicitudId: sol(), grupos: ["gb@g.us"], imagen: undefined });
    assert.deepStrictEqual([ajeno.status, ajeno.json.motivo], [409, "destinos_no_disponibles"]);
    assert.strictEqual((await llamar("POST", "/tablas/compartir", { precio: 5000, solicitudId: sol(), imagen: undefined }, "jwt-B")).json.motivo, "sin_destinos");
    assert.strictEqual(capturas, capturasAntes, "sin validaciones superadas no se abre el navegador");
    const id = sol();
    await llamar("POST", "/tablas/compartir", { precio: 5000, solicitudId: id, grupos: ["g1@g.us"], imagen: undefined });
    const repetida = await llamar("POST", "/tablas/compartir", { precio: 5000, solicitudId: id, grupos: ["g1@g.us"], imagen: undefined });
    assert.strictEqual(repetida.json.resultados[0].estado, "ya_enviado");
    assert.strictEqual(envios.length, 1, "misma solicitud: un solo envío");
    sockets.delete(A);
    const sinSesion = await llamar("POST", "/tablas/compartir", { precio: 5000, solicitudId: sol(), grupos: ["g1@g.us"], imagen: undefined });
    assert.deepStrictEqual([sinSesion.status, sinSesion.json.motivo], [409, "sin_sesion_activa"]);
});

prueba("18. Panel publicado y Puppeteer falla: 502 error_imagen y no se envía nada", async () => {
    escenario();
    nav.fallar = true;
    const r = await llamar("POST", "/tablas/compartir", { precio: 5000, solicitudId: sol(), grupos: ["g1@g.us"], imagen: undefined });
    assert.deepStrictEqual([r.status, r.json.motivo, envios.length], [502, "error_imagen", 0]);
});

prueba("19. Vista previa del panel publicado (sin sin_imagen): sigue trayendo la imagen del flujo anterior", async () => {
    escenario();
    const capturasAntes = capturas;
    const v = (await llamar("GET", "/tablas/compartir/vista-previa?precio=5000")).json.data;
    assert.strictEqual(Buffer.from(v.imagen.split(",")[1], "base64").toString("base64"), IMG_PUPPETEER_A);
    assert.strictEqual(v.error_imagen, null);
    assert.strictEqual(capturas, capturasAntes + 1);
    nav.fallar = true;
    const sinImg = (await llamar("GET", "/tablas/compartir/vista-previa?precio=5000")).json.data;
    assert.deepStrictEqual([sinImg.imagen, typeof sinImg.error_imagen, sinImg.texto.length > 0], [null, "string", true]);
});

prueba("20. Límite de cuerpo: un PNG de ~2 MB entra por /tablas/compartir; el resto de rutas sigue en 100 KB", async () => {
    escenario();
    const grande = Buffer.concat([Buffer.from(PNG_B64, "base64"), Buffer.alloc(2 * 1024 * 1024)]);
    const r = await llamar("POST", "/tablas/compartir", { precio: 5000, solicitudId: sol(), grupos: ["g1@g.us"], imagen: `data:image/png;base64,${grande.toString("base64")}` });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.strictEqual(Buffer.from(envios[0].image, "base64").length, grande.length);
    const res = await fetch(`${base}/tablas/inicializar`, { method: "POST", headers: h("jwt-A"), body: JSON.stringify({ relleno: "x".repeat(200 * 1024) }) });
    assert.strictEqual(res.status, 413, "el límite global (100 KB) no cambia para otras rutas");
});

(async () => {
    const server = http.createServer(app);
    await new Promise(r => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${server.address().port}`;
    let ok = 0, falla = 0;
    for (const { nombre, fn } of pruebas) {
        const silencio = {}; for (const m of ["log", "error", "warn", "table", "dir"]) { silencio[m] = console[m]; console[m] = () => {}; }
        try { await fn(); ok++; Object.assign(console, silencio); console.log(`✅ ${nombre}`); }
        catch (e) { falla++; Object.assign(console, silencio); console.log(`❌ ${nombre}`); console.log("   ", e && e.stack); }
    }
    server.close();
    console.log(`\n============================\nTOTAL: ${ok + falla}  ✅ PASA: ${ok}  ❌ FALLA: ${falla}\n============================`);
    process.exit(falla ? 1 : 0);
})();
