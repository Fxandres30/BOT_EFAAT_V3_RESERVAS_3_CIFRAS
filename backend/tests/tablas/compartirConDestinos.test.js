// ==========================================================================
// PRUEBAS — botón «Compartir» de Tablas con grupos de destino elegidos y
// guardados: vista previa (sin enviar), caption, primera selección,
// persistencia, envío de un clic, duplicados y aislamiento entre clientes.
//
// Ruta HTTP REAL (routes/tablas.js + exigirUsuario), servicios reales
// (compartirTabla, destinosCompartir, sorteosActivos, executionGuard);
// Supabase en memoria, navegador y WhatsApp SIMULADOS: ningún envío real.
//
//     node backend/tests/tablas/compartirConDestinos.test.js
// ==========================================================================

const assert = require("assert");
const path = require("path");
const http = require("http");
const express = require("express");

const { crearFake } = require("../sorteos/fakeSupabaseSorteos");

process.env.TABLA_SHARE_SECRET = "secreto-de-prueba";
process.env.SESSIONS_API_TOKEN = "token-servicio-compartir";

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
        envios.push({ usuario: sock.usuario, jid, image: image.toString(), caption });
    },
    sendMessage: async () => { throw new Error("no debe enviarse texto suelto"); }
});
const sockets = new Map();
inyectar("services/baileys/manager.js", { getSocketActivoDe: (u) => sockets.get(u) || null });

// Navegador simulado: la "imagen" lleva el dueño y el evento firmados en la URL.
let capturas = 0;
const nav = { fallar: false };
const PUPPETEER = require.resolve("puppeteer", { paths: [RAIZ] });
require.cache[PUPPETEER] = {
    id: PUPPETEER, filename: PUPPETEER, loaded: true,
    exports: {
        launch: async () => {
            capturas++;
            let url = "";
            return {
                newPage: async () => ({
                    setViewport: async () => {},
                    goto: async (u) => { if (nav.fallar) throw new Error("timeout"); url = u; },
                    waitForSelector: async () => ({ screenshot: async () => Buffer.from(`PNG ${new URL(url).pathname} ${new URL(url).searchParams.get("token").split(".")[1]}`) })
                }),
                close: async () => {}
            };
        }
    }
};

const app = express();
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
    t[T5K] = [A, B].flatMap(u => Array.from({ length: 100 }, (_, i) => ({ numero: String(i).padStart(2, "0"), estado: i < 3 ? "pagado" : "libre", usuario_id: u })));
}

let base;
const h = (jwt) => ({ "content-type": "application/json", "x-service-token": "token-servicio-compartir", authorization: `Bearer ${jwt}` });
const llamar = async (metodo, camino, cuerpo, jwt = "jwt-A") => {
    const res = await fetch(base + camino, { method: metodo, headers: h(jwt), ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}) });
    return { status: res.status, json: await res.json() };
};
let n = 0;
const sol = () => `00000000-0000-4000-9000-${String(++n).padStart(12, "0")}`;
const destinosDe = (u) => (fake.tablas.destinos_compartir_tabla || []).filter(d => d.usuario_id === u);
// Lo que compartir NUNCA debe tocar (reservas, pagos, números, eventos...).
const intocable = () => JSON.stringify([fake.tablas[T5K], fake.tablas.eventos_bot, fake.tablas.grupos_autorizados, fake.tablas.sorteos_programados || null]);

const pruebas = [];
const prueba = (nombre, fn) => pruebas.push({ nombre, fn });

prueba("1. Vista previa: imagen real de la tabla del cliente, texto habitual, SUS grupos; no envía nada", async () => {
    escenario();
    const r = await llamar("GET", "/tablas/compartir/vista-previa?precio=5000");
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    const v = r.json.data;
    assert.ok(v.imagen.startsWith("data:image/png;base64,"));
    assert.strictEqual(Buffer.from(v.imagen.split(",")[1], "base64").toString(), `PNG /tablas/imprimir/5000 ${A}`, "la cuadrícula de A");
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
    assert.ok(envios.every(e => e.image === `PNG /tablas/imprimir/5000 ${A}`), "imagen real de la tabla de A");
    assert.strictEqual(capturas > 0, true);
    assert.deepStrictEqual(destinosDe(A).map(d => [d.precio, d.grupos]), [[5000, ["g1@g.us", "g2@g.us"]]]);
    assert.strictEqual(intocable(), antes, "reservas, pagos, números y sorteo intactos");
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
    assert.strictEqual(capturas, capturasAntes + 1, "una sola captura de la imagen ACTUAL por envío");
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
    assert.ok(Buffer.from(vB.imagen.split(",")[1], "base64").toString().endsWith(B), "imagen de la tabla de B");
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

prueba("9. Resultado por grupo: uno falla y se informa; si falla la imagen no se envía nada", async () => {
    escenario();
    sim.fallarEn.add("g2@g.us");
    const r = await llamar("POST", "/tablas/compartir", { precio: 5000, solicitudId: sol(), grupos: ["g1@g.us", "g2@g.us"] });
    assert.deepStrictEqual([r.json.enviado, r.json.enviados, r.json.fallidos], [true, 1, 1]);
    assert.deepStrictEqual(r.json.resultados.map(x => [x.grupo_id, x.estado]), [["g1@g.us", "enviado"], ["g2@g.us", "fallido"]]);
    assert.ok(/not-authorized/.test(r.json.resultados[1].error));
    nav.fallar = true;
    envios.length = 0;
    const sinImagen = await llamar("POST", "/tablas/compartir", { precio: 5000, solicitudId: sol(), grupos: ["g1@g.us"] });
    assert.deepStrictEqual([sinImagen.status, sinImagen.json.motivo, envios.length], [502, "error_imagen", 0]);
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
    assert.deepStrictEqual(envios.map(e => e.jid), ["g1@g.us"]);
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
