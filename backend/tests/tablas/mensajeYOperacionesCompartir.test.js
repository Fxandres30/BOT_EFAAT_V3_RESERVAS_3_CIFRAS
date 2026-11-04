// ==========================================================================
// PRUEBAS — «Compartir tabla»: MENSAJE ÚNICO y OPERACIONES con progreso real
// y cancelación (04/11).
//
//   A. El mensaje del sorteo es la única fuente: vista previa = envío =
//      segundo envío = tabla inicial automática; editar desde «Compartir»
//      cambia ESE mensaje; un error de lectura nunca cae a otra plantilla.
//   B. Operaciones: progreso grupo a grupo desde los resultados reales,
//      cancelación antes / durante, idempotencia, cerrar la ventana,
//      errores, reintentos sin duplicados y aislamiento entre clientes.
//
// Ruta HTTP REAL (routes/tablas.js + exigirUsuario) y servicios reales
// (destinosCompartir, sorteosActivos, compartirTabla, executionGuard,
// operacionesCompartir). Supabase en memoria; WhatsApp y navegador
// SIMULADOS: ningún envío real ni conexión a producción.
//
//     EFAAT_PRUEBAS=1 SUPABASE_URL=http://127.0.0.1:9 node backend/tests/tablas/mensajeYOperacionesCompartir.test.js
// ==========================================================================

const assert = require("assert");
const path = require("path");
const http = require("http");
const express = require("express");

const { crearFake } = require("../sorteos/fakeSupabaseSorteos");

delete process.env.TABLA_SHARE_SECRET;
process.env.SESSIONS_API_TOKEN = "token-servicio-ops";
process.env.FRONTEND_URL = "http://127.0.0.1:3999";

const RAIZ = path.resolve(__dirname, "../..");
function inyectar(rutaRel, exportsObj) {
    const abs = path.join(RAIZ, rutaRel);
    require.cache[abs] = { id: abs, filename: abs, loaded: true, exports: exportsObj };
}

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const T5K = "5k_15k_reservas_2_cifras";
const IDENT = "ident-chontico";
const SORTEO = "50000000-0000-4000-8000-000000000001";
const ev = (n) => `e0000000-0000-4000-8000-00000000000${n}`;

let fake = crearFake();
inyectar("lib/supabase.js", { from: (t) => fake.client.from(t), auth: { getUser: (t) => fake.client.auth.getUser(t) } });
inyectar("bot/funciones/eventos/configEvento.js", {
    obtenerConfiguracion: () => ({ tabla: T5K, cifras: 2, cantidad: 100 }),
    configuracionesBase: () => [{ precio: 5000, tabla: T5K, cifras: 2, cantidad: 100 }]
});

// WhatsApp simulado. `puertas`: un envío a ese grupo espera hasta que la
// prueba lo suelte (envío «en curso» controlado).
const envios = [];
const sim = { fallarEn: new Set(), puertas: new Map(), llamadas: [] };
const puerta = (jid) => { let abrir; const p = new Promise(r => { abrir = r; }); sim.puertas.set(jid, { p, abrir }); return abrir; };
inyectar("services/baileys/send.js", {
    sendImage: async ({ sock, jid, image, caption }) => {
        sim.llamadas.push(jid);
        const pu = sim.puertas.get(jid);
        if (pu) await pu.p;
        if (sim.fallarEn.has(jid)) throw new Error("not-authorized");
        envios.push({ usuario: sock.usuario, jid, image: image.toString("base64"), caption });
    },
    sendMessage: async () => { throw new Error("no debe enviarse texto suelto"); }
});
const sockets = new Map();
inyectar("services/baileys/manager.js", { getSocketActivoDe: (u) => sockets.get(u) || null });

// Navegador simulado (solo panel anterior / scheduler): una captura lenta
// controlable para cancelar «antes del primer envío».
const nav = { puerta: null };
const CABECERA_PNG = (() => {
    const b = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
    b.writeUInt32BE(13, 8); b.write("IHDR", 12, "ascii"); b.writeUInt32BE(100, 16); b.writeUInt32BE(100, 20);
    return b;
})();
const PUPPETEER = require.resolve("puppeteer", { paths: [RAIZ] });
require.cache[PUPPETEER] = {
    id: PUPPETEER, filename: PUPPETEER, loaded: true,
    exports: {
        launch: async () => {
            let manejador = null;
            return {
                newPage: async () => ({
                    setViewport: async () => {},
                    setRequestInterception: async () => {},
                    on: (e, fn) => { if (e === "request") manejador = fn; },
                    goto: async (u) => {
                        if (nav.puerta) await nav.puerta.p;
                        const origen = new URL(u).origin;
                        await new Promise(ok => manejador({ url: () => `${origen}/api/tablas/imprimir?precio=5000&token=x`, respond: () => ok(), continue: () => ok() }));
                    },
                    waitForSelector: async () => ({}),
                    evaluate: async () => `data:image/png;base64,${CABECERA_PNG.toString("base64")}`
                }),
                close: async () => {}
            };
        }
    }
};

// Grupos nuevos: el publicador real se prueba en gruposDelSorteo.test.js.
// Aquí solo se comprueba QUÉ le pasa la ruta (instantánea del mensaje,
// progreso) y que la cancelación previa lo evita.
const gruposSorteo = require("../../sorteos/gruposSorteo");
const llamadasNuevos = [];
gruposSorteo.publicarGruposNuevos = async (usuarioId, sorteoId, opciones) => {
    llamadasNuevos.push({ usuarioId, sorteoId, opciones });
    const pendientes = fake.tablas.sorteos_programados_grupos.filter(g => g.sorteo_id === sorteoId && g.estado === "pendiente");
    for (const g of pendientes) {
        opciones.observar?.alPreparar?.(g.grupo_id);
        opciones.observar?.alEnviar?.(g.grupo_id);
        envios.push({ usuario: usuarioId, jid: g.grupo_id, caption: opciones.anuncio?.texto, image: "publicador" });
        g.estado = "publicado";
    }
    return { ok: true, data: { grupos: fake.tablas.sorteos_programados_grupos.filter(g => g.sorteo_id === sorteoId) } };
};

const operaciones = require("../../services/operacionesCompartir");

const app = express();
app.use("/tablas/compartir", express.json({ limit: "6mb" }));
app.use(express.json());
app.use("/tablas", require("../../routes/tablas"));

const MENSAJE = "🎟️ *{{nombre}}* {{fecha_titulo}}\nValor {{valor}} · cierra {{hora_cierre}}\n│ {{premios}}\nPaga a:\n{{cuentas}}";
const ESPERADO = "🎟️ *Chontico Noche* Jueves 22 de octubre\nValor $5.000 · cierra 10:26 PM\n│ 🍀 Mayor: $100.000\n│ 🍀 Seco: $20.000\nPaga a:\n• Nequi: 3001234567 (Ana)";

function escenario({ grupos = ["g1@g.us", "g2@g.us", "g3@g.us"], mensaje = MENSAJE } = {}) {
    fake = crearFake();
    operaciones._reiniciar();
    const t = fake.tablas;
    fake.tokens["jwt-A"] = A;
    fake.tokens["jwt-B"] = B;
    envios.length = 0;
    sim.fallarEn = new Set();
    sim.puertas = new Map();
    sim.llamadas = [];
    nav.puerta = null;
    llamadasNuevos.length = 0;
    sockets.clear();
    sockets.set(A, { usuario: A });
    sockets.set(B, { usuario: B });
    t.grupos_autorizados = [
        ...["g1@g.us", "g2@g.us", "g3@g.us", "g4@g.us"].map(g => ({ usuario_id: A, grupo_id: g, activo: true })),
        { usuario_id: B, grupo_id: "gb@g.us", activo: true }
    ];
    t.grupos = [["g1@g.us", "Rifa uno"], ["g2@g.us", "Rifa dos"], ["g3@g.us", "Rifa tres"], ["g4@g.us", "Rifa cuatro"], ["gb@g.us", "Grupo de B"]].map(([jid, nombre]) => ({ jid, nombre }));
    const fila = (id, u, grupo, identidad, nombre) => ({
        id, usuario_id: u, grupo_id: grupo, activo: true, abierto: true, estado: "abierto", identidad_evento_real: identidad,
        nombre_evento: nombre, hora_fin: "22:30", hora_cierre: "22:26", fecha_evento: "2026-10-22", valor: 5000,
        premios: [{ tipo: "otro", nombre: "Mayor", premio: 100000 }, { tipo: "otro", nombre: "Seco", premio: 20000 }],
        tabla: T5K, cifras: 2, cantidad_numeros: 100, creado_en: `2026-10-22T12:00:0${id.slice(-1)}Z`
    });
    t.eventos_bot = [
        ...grupos.map((g, i) => fila(ev(i + 1), A, g, IDENT, "Chontico Noche")),
        fila("e0000000-0000-4000-8000-0000000000b1", B, "gb@g.us", "ident-b", "Secreto de B")
    ];
    // La fila más reciente de la tabla es la de g1 (la que «Compartir» toma).
    t.eventos_bot[0].creado_en = "2026-10-22T12:59:00Z";
    t.sorteos_programados = [{
        id: SORTEO, usuario_id: A, estado: "publicado", version: 1, confirmado_version: 1, identidad_evento_real: IDENT, tabla: T5K,
        creado_en: "2026-10-22T11:00:00Z", publicar_en: "2026-10-22T11:30:00Z",
        cuentas_snapshot: [{ id: "c1", nombre: "Nequi", tipo: "nequi", titular: "Ana", numero: "3001234567", instrucciones: null }],
        config: {
            nombre: "Chontico Noche", hora_fin: "22:30", hora_cierre: "22:26", valor: 5000, cuentas: ["c1"],
            premios: [{ nombre: "Mayor", premio: 100000 }, { nombre: "Seco", premio: 20000 }],
            mensajes: { publicacion: mensaje, publicacion_meta: { estilo: "clasico", activo: true, personalizado: true, revision: 3, actualizado_en: "2026-10-22T11:00:00Z" } }
        }
    }];
    t.sorteos_programados_grupos = grupos.map((g, i) => ({ id: `fila-${i}`, usuario_id: A, sorteo_id: SORTEO, grupo_id: g, grupo_nombre: null, estado: "publicado", intentos: 1, reintentos_manuales: 0, creado_en: `2026-10-22T11:00:0${i}Z` }));
    t[T5K] = [A, B].flatMap(u => Array.from({ length: 100 }, (_, i) => ({ numero: String(i).padStart(2, "0"), estado: i < 3 ? "pagado" : i < 6 ? "reservado" : "libre", usuario_id: u })));
}

let base;
const h = (jwt) => ({ "content-type": "application/json", "x-service-token": "token-servicio-ops", authorization: `Bearer ${jwt}` });
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const PNG_DATA_URL = `data:image/png;base64,${PNG_B64}`;
const llamar = async (metodo, camino, cuerpo, jwt = "jwt-A") => {
    const res = await fetch(base + camino, { method: metodo, headers: h(jwt), ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}) });
    return { status: res.status, json: await res.json() };
};
let n = 0;
const sol = () => `00000000-0000-4000-9000-${String(++n).padStart(12, "0")}`;
const espera = (ms) => new Promise(r => setTimeout(r, ms));
async function hasta(cond, ms = 2000) {
    const fin = Date.now() + ms;
    while (Date.now() < fin) { if (await cond()) return true; await espera(5); }
    throw new Error("la condición no se cumplió a tiempo");
}
const progreso = async (id, jwt = "jwt-A") => (await llamar("GET", `/tablas/compartir/operaciones/${id}`, null, jwt));
const enviar = (cuerpo, jwt) => llamar("POST", "/tablas/compartir", { precio: 5000, imagen: PNG_DATA_URL, asincrono: true, ...cuerpo }, jwt);
const intocable = () => JSON.stringify({ [T5K]: fake.tablas[T5K], eventos_bot: fake.tablas.eventos_bot, grupos: fake.tablas.sorteos_programados_grupos });
const terminada = async (id) => { let d; await hasta(async () => (d = (await progreso(id)).json.data)?.terminada); return d; };

const pruebas = [];
const prueba = (nombre, fn) => pruebas.push({ nombre, fn });

// ------------------------------------------------------ A. mensaje único ---

prueba("A1. Vista previa = mensaje personalizado del sorteo con variables resueltas (saltos, emojis, premios, precio, hora, cuentas)", async () => {
    escenario();
    const v = (await llamar("GET", "/tablas/compartir/vista-previa?precio=5000&sin_imagen=1")).json.data;
    assert.strictEqual(v.texto, ESPERADO);
    assert.strictEqual(v.origen_texto, "sorteo");
    assert.deepStrictEqual([v.mensaje.plantilla, v.mensaje.fuente, v.mensaje.revision], [MENSAJE, "panel", 3]);
});

prueba("A2. Primera publicación y SEGUNDO «Compartir»: exactamente el texto de la vista previa; nunca la plantilla habitual", async () => {
    escenario();
    const vista = (await llamar("GET", "/tablas/compartir/vista-previa?precio=5000&sin_imagen=1")).json.data.texto;
    const uno = await enviar({ solicitudId: sol() });
    assert.strictEqual(uno.status, 202, JSON.stringify(uno.json));
    await terminada(uno.json.operacion.id);
    const dos = await enviar({ solicitudId: sol() });
    await terminada(dos.json.operacion.id);
    assert.strictEqual(envios.length, 6);
    assert.ok(envios.every(e => e.caption === vista), envios.map(e => e.caption).join("\n---\n"));
    assert.ok(envios.every(e => !/Aparta el tuyo|números disponibles/.test(e.caption)), "sin texto habitual");
    assert.strictEqual(uno.json.operacion.mensaje.texto, vista, "la operación guarda la instantánea aprobada");
});

prueba("A3. Editar el mensaje desde «Compartir» cambia EL mensaje del sorteo: la vista previa nueva = lo enviado = el siguiente envío", async () => {
    escenario();
    const v = (await llamar("GET", "/tablas/compartir/vista-previa?precio=5000&sin_imagen=1")).json.data;
    const nuevo = "🔥 {{nombre_mayusculas}}\n{{premios_linea}}\nSolo {{valor}}";
    const r = await llamar("PUT", "/tablas/compartir/mensaje", { precio: 5000, plantilla: nuevo, base_plantilla: v.mensaje.plantilla });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.strictEqual(r.json.data.texto, "🔥 CHONTICO NOCHE\nMayor $100.000 · Seco $20.000\nSolo $5.000");
    const guardado = fake.tablas.sorteos_programados[0].config.mensajes;
    assert.deepStrictEqual([guardado.publicacion, guardado.publicacion_meta.revision], [nuevo, 4], "se guardó en el sorteo (misma fuente que «Editar»)");
    const v2 = (await llamar("GET", "/tablas/compartir/vista-previa?precio=5000&sin_imagen=1")).json.data;
    assert.strictEqual(v2.texto, r.json.data.texto);
    await terminada((await enviar({ solicitudId: sol(), grupos: ["g1@g.us"] })).json.operacion.id);
    await terminada((await enviar({ solicitudId: sol(), grupos: ["g2@g.us"] })).json.operacion.id);
    assert.deepStrictEqual(envios.map(e => e.caption), [v2.texto, v2.texto]);
});

prueba("A4. Editar con una versión vieja (otra pestaña cambió el mensaje) -> 409 y no se pisa; variable inexistente -> 400", async () => {
    escenario();
    const r = await llamar("PUT", "/tablas/compartir/mensaje", { precio: 5000, plantilla: "Hola {{nombre}}", base_plantilla: "otro texto" });
    assert.deepStrictEqual([r.status, r.json.motivo], [409, "version_cambiada"]);
    const mal = await llamar("PUT", "/tablas/compartir/mensaje", { precio: 5000, plantilla: "Hola {{inventada}}", base_plantilla: MENSAJE });
    assert.strictEqual(mal.status, 400, JSON.stringify(mal.json));
    assert.strictEqual(fake.tablas.sorteos_programados[0].config.mensajes.publicacion, MENSAJE, "intacto");
    assert.strictEqual(envios.length, 0, "editar nunca envía");
});

prueba("A5. No se puede leer el sorteo: vista previa y envío fallan con aviso; NUNCA se envía otra plantilla", async () => {
    escenario();
    fake.control.fallarTabla = "sorteos_programados";
    // Falla al leer los grupos del sorteo (500) o su mensaje (503): en ambos
    // casos no hay vista previa con ningún texto.
    const v = await llamar("GET", "/tablas/compartir/vista-previa?precio=5000&sin_imagen=1");
    assert.ok(v.status >= 500 && v.json.ok === false && !v.json.data, JSON.stringify(v.json));
    // Solo el mensaje ilegible (los grupos sí se leen): 503 con su motivo.
    fake.control.fallarTabla = null;
    const sorteosActivos = require("../../sorteos/sorteosActivos");
    const original = sorteosActivos.obtener;
    sorteosActivos.obtener = async () => ({ ok: false, motivo: "error_supabase" });
    try {
        const solo = await llamar("GET", "/tablas/compartir/vista-previa?precio=5000&sin_imagen=1");
        assert.deepStrictEqual([solo.status, solo.json.motivo], [503, "texto_no_disponible"]);
        const env = await enviar({ solicitudId: sol(), grupos: ["g1@g.us"] });
        assert.deepStrictEqual([env.status, env.json.motivo], [503, "texto_no_disponible"]);
    } finally {
        sorteosActivos.obtener = original;
    }
    fake.control.fallarTabla = "sorteos_programados";
    const r = await enviar({ solicitudId: sol() });
    // Sin poder leer la programación tampoco se conocen sus grupos: no se envía.
    assert.ok(r.status >= 400, JSON.stringify(r.json));
    await espera(30);
    assert.strictEqual(envios.length, 0);
});

prueba("A6. Una programación CANCELADA más reciente con la misma identidad no cambia el mensaje", async () => {
    escenario();
    fake.tablas.sorteos_programados.push({ ...fake.tablas.sorteos_programados[0], id: "50000000-0000-4000-8000-000000000002", estado: "cancelado", creado_en: "2026-10-22T11:50:00Z", config: { ...fake.tablas.sorteos_programados[0].config, mensajes: { publicacion: "TEXTO DE OTRA PROGRAMACIÓN", publicacion_meta: { estilo: "clasico", activo: true } } } });
    const v = (await llamar("GET", "/tablas/compartir/vista-previa?precio=5000&sin_imagen=1")).json.data;
    assert.strictEqual(v.texto, ESPERADO);
});

prueba("A7. Tabla inicial automática (scheduler) y panel anterior: el MISMO mensaje del sorteo, no la plantilla habitual", async () => {
    escenario();
    const { compartirTabla } = require("../../services/compartirTabla");
    const s = await compartirTabla({ evento: fake.tablas.eventos_bot[0], sock: sockets.get(A) });
    assert.deepStrictEqual(s, { enviado: true });
    const antiguo = await llamar("POST", "/tablas/compartir", { precio: 5000 });
    assert.strictEqual(antiguo.json.enviado, true);
    assert.deepStrictEqual(envios.map(e => e.caption), [ESPERADO, ESPERADO]);
    fake.control.fallarTabla = "sorteos_programados";
    const sinTexto = await compartirTabla({ evento: fake.tablas.eventos_bot[0], sock: sockets.get(A) });
    assert.deepStrictEqual(sinTexto, { enviado: false, motivo: "texto_no_disponible" });
    assert.strictEqual(envios.length, 2, "sin el mensaje no se publica nada");
    // Ciclo del Scheduler (con idempotencia): una vez; después ni reenvía
    // ni vuelve a leer el sorteo.
    fake.control.fallarTabla = null;
    const idem = { claveIdempotencia: "ciclo-1:INITIAL_TABLE", eventSessionId: "ciclo-1", tipoAccion: "INITIAL_TABLE" };
    assert.deepStrictEqual(await compartirTabla({ evento: fake.tablas.eventos_bot[0], sock: sockets.get(A), idempotencia: idem }), { enviado: true });
    const lecturas = () => fake.control.llamadas.filter(l => l.tabla === "sorteos_programados").length;
    const antesLecturas = lecturas();
    const segunda = await compartirTabla({ evento: fake.tablas.eventos_bot[0], sock: sockets.get(A), idempotencia: idem });
    assert.deepStrictEqual(segunda, { enviado: false, motivo: "ya_ok" });
    assert.strictEqual(lecturas(), antesLecturas, "ya registrada: no relee el mensaje");
    assert.deepStrictEqual(envios.map(e => e.caption), [ESPERADO, ESPERADO, ESPERADO]);
});

prueba("A8. Instantánea: editar el mensaje con un envío en curso no cambia lo que reciben los grupos pendientes de ESA operación", async () => {
    escenario();
    const abrir = puerta("g1@g.us");
    const r = await enviar({ solicitudId: sol() });
    await hasta(() => sim.llamadas.includes("g1@g.us"));
    const put = await llamar("PUT", "/tablas/compartir/mensaje", { precio: 5000, plantilla: "Mensaje NUEVO {{nombre}}", base_plantilla: MENSAJE });
    assert.strictEqual(put.status, 200);
    abrir();
    await terminada(r.json.operacion.id);
    assert.deepStrictEqual(envios.map(e => e.caption), [ESPERADO, ESPERADO, ESPERADO]);
    await terminada((await enviar({ solicitudId: sol(), grupos: ["g1@g.us"] })).json.operacion.id);
    assert.strictEqual(envios[3].caption, "Mensaje NUEVO Chontico Noche", "la operación siguiente ya usa el mensaje editado");
});

prueba("A9. Grupo nuevo del sorteo: el publicador recibe la MISMA instantánea del mensaje", async () => {
    escenario({ grupos: ["g1@g.us"] });
    fake.tablas.sorteos_programados_grupos.push({ id: "fila-n", usuario_id: A, sorteo_id: SORTEO, grupo_id: "g4@g.us", estado: "pendiente", intentos: 0, reintentos_manuales: 0, creado_en: "2026-10-22T11:09:00Z" });
    const r = await enviar({ solicitudId: sol(), grupos: ["g4@g.us", "g1@g.us"] });
    const d = await terminada(r.json.operacion.id);
    assert.strictEqual(llamadasNuevos.length, 1);
    assert.deepStrictEqual(llamadasNuevos[0].opciones.anuncio, { texto: ESPERADO, activo: true });
    assert.deepStrictEqual(d.grupos.map(g => [g.grupo_id, g.tipo, g.estado]), [["g4@g.us", "activar", "enviado"], ["g1@g.us", "compartir", "enviado"]]);
    assert.ok(envios.every(e => e.caption === ESPERADO));
});

// ---------------------------------------------------- B. operaciones ---

prueba("B1. Progreso real: 202 al aceptar; cada grupo pasa por en_cola/enviando/enviado según WhatsApp; totales y porcentaje", async () => {
    escenario();
    const abrir1 = puerta("g1@g.us");
    const abrir2 = puerta("g2@g.us");
    const r = await enviar({ solicitudId: sol() });
    assert.strictEqual(r.status, 202);
    assert.deepStrictEqual(r.json.operacion.totales, { total: 3, enviados: 0, fallidos: 0, cancelados: 0, en_curso: 0, pendientes: 3, porcentaje: 0 });
    await hasta(() => sim.llamadas.includes("g1@g.us"));
    let d = (await progreso(r.json.operacion.id)).json.data;
    assert.deepStrictEqual(d.grupos.map(g => g.estado), ["enviando", "en_cola", "en_cola"]);
    abrir1();
    await hasta(() => sim.llamadas.includes("g2@g.us"));
    d = (await progreso(r.json.operacion.id)).json.data;
    assert.deepStrictEqual(d.grupos.map(g => g.estado), ["enviado", "enviando", "en_cola"]);
    assert.deepStrictEqual([d.totales.enviados, d.totales.pendientes, d.totales.porcentaje], [1, 2, 33]);
    abrir2();
    d = await terminada(r.json.operacion.id);
    assert.deepStrictEqual([d.estado, d.totales.enviados, d.totales.porcentaje], ["completada", 3, 100]);
});

prueba("B2. Cancelar ANTES del primer envío (imagen aún preparándose): ningún grupo recibe nada", async () => {
    escenario();
    let abrirNav; nav.puerta = { p: new Promise(r => { abrirNav = r; }) };
    // Panel anterior (sin imagen): la captura lenta deja tiempo para cancelar.
    const r = await llamar("POST", "/tablas/compartir", { precio: 5000, solicitudId: sol(), asincrono: true });
    assert.strictEqual(r.status, 202, JSON.stringify(r.json));
    const c = await llamar("POST", `/tablas/compartir/operaciones/${r.json.operacion.id}/cancelar`);
    assert.deepStrictEqual([c.status, c.json.data.estado], [200, "cancelando"]);
    abrirNav();
    const d = await terminada(r.json.operacion.id);
    await espera(30);
    assert.strictEqual(envios.length, 0);
    assert.strictEqual(sim.llamadas.length, 0, "WhatsApp ni siquiera fue llamado");
    assert.deepStrictEqual([d.estado, d.totales.cancelados, d.totales.enviados], ["cancelada", 3, 0]);
});

prueba("B3. Cancelar después de un envío y con otro en curso: el en curso termina y se registra; los pendientes NO se envían", async () => {
    escenario({ grupos: ["g1@g.us", "g2@g.us", "g3@g.us", "g4@g.us"] });
    const abrir2 = puerta("g2@g.us");
    const r = await enviar({ solicitudId: sol() });
    await hasta(() => sim.llamadas.includes("g2@g.us"));
    const c = await llamar("POST", `/tablas/compartir/operaciones/${r.json.operacion.id}/cancelar`);
    assert.deepStrictEqual(c.json.data.grupos.map(g => g.estado), ["enviado", "enviando", "en_cola", "en_cola"]);
    abrir2();
    const d = await terminada(r.json.operacion.id);
    await espera(50);
    assert.deepStrictEqual(envios.map(e => e.jid), ["g1@g.us", "g2@g.us"]);
    assert.deepStrictEqual(sim.llamadas, ["g1@g.us", "g2@g.us"], "g3 y g4 nunca llegaron a WhatsApp");
    assert.deepStrictEqual(d.grupos.map(g => g.estado), ["enviado", "enviado", "cancelado", "cancelado"]);
    assert.strictEqual(d.estado, "cancelada");
    assert.ok(/publicó en 2 de 4/.test(d.etapa) && /no se retira/.test(d.etapa), d.etapa);
});

prueba("B4. Cancelar es idempotente; cancelar una operación terminada no cambia nada", async () => {
    escenario();
    const abrir = puerta("g1@g.us");
    const r = await enviar({ solicitudId: sol() });
    await hasta(() => sim.llamadas.includes("g1@g.us"));
    const c1 = await llamar("POST", `/tablas/compartir/operaciones/${r.json.operacion.id}/cancelar`);
    const c2 = await llamar("POST", `/tablas/compartir/operaciones/${r.json.operacion.id}/cancelar`);
    assert.deepStrictEqual([c1.json.ya_solicitada, c2.json.ya_solicitada], [false, true]);
    assert.strictEqual(c1.json.data.cancelacion_solicitada_en, c2.json.data.cancelacion_solicitada_en);
    abrir();
    const d = await terminada(r.json.operacion.id);
    const c3 = await llamar("POST", `/tablas/compartir/operaciones/${r.json.operacion.id}/cancelar`);
    assert.deepStrictEqual([c3.status, c3.json.ya_terminada, c3.json.data.estado], [200, true, d.estado]);
    assert.strictEqual(envios.length, 1);
});

prueba("B5. Cerrar la ventana no cancela: la operación sigue sola y se recupera por precio (envío en curso y resultado)", async () => {
    escenario();
    const abrir = puerta("g2@g.us");
    const r = await enviar({ solicitudId: sol() });
    // El panel cierra la ventana: no consulta nada más mientras tanto.
    await hasta(() => sim.llamadas.includes("g2@g.us"));
    const enCurso = (await llamar("GET", "/tablas/compartir/operaciones?precio=5000")).json.data;
    assert.strictEqual(enCurso.activa.id, r.json.operacion.id);
    const vista = (await llamar("GET", "/tablas/compartir/vista-previa?precio=5000&sin_imagen=1")).json.data;
    assert.strictEqual(vista.operacion_activa.id, r.json.operacion.id, "al reabrir «Compartir» se ve el envío en curso");
    const otro = await enviar({ solicitudId: sol() });
    assert.deepStrictEqual([otro.status, otro.json.motivo, otro.json.operacion.id], [409, "envio_en_curso", r.json.operacion.id]);
    abrir();
    await hasta(() => envios.length === 3);
    const fin = (await llamar("GET", "/tablas/compartir/operaciones?precio=5000")).json.data;
    assert.strictEqual(fin.activa, null);
    assert.strictEqual(fin.recientes[0].estado, "completada");
});

prueba("B6. Errores y reintentos: un grupo falla y los demás siguen; repetir la MISMA solicitud no duplica (también tras reiniciar el proceso)", async () => {
    escenario();
    sim.fallarEn.add("g2@g.us");
    const id = sol();
    const r = await enviar({ solicitudId: id });
    const d = await terminada(r.json.operacion.id);
    assert.deepStrictEqual(d.grupos.map(g => g.estado), ["enviado", "error", "enviado"]);
    assert.ok(/not-authorized/.test(d.grupos[1].error));
    assert.strictEqual(d.estado, "con_errores");
    const repetida = await enviar({ solicitudId: id });
    assert.deepStrictEqual([repetida.status, repetida.json.repetida, repetida.json.operacion.estado], [200, true, "con_errores"]);
    // Proceso reiniciado (se pierde el registro en memoria): la misma
    // solicitud vuelve a ejecutarse y el ExecutionGuard evita el duplicado.
    operaciones._reiniciar();
    sim.fallarEn.clear();
    const tras = await enviar({ solicitudId: id });
    const d2 = await terminada(tras.json.operacion.id);
    assert.deepStrictEqual(d2.grupos.map(g => [g.estado, g.detalle || null]), [["enviado", "Ya se había enviado en esta misma solicitud: no se duplicó."], ["error", null], ["enviado", "Ya se había enviado en esta misma solicitud: no se duplicó."]]);
    assert.deepStrictEqual(envios.map(e => e.jid), ["g1@g.us", "g3@g.us"], "ningún grupo recibió dos veces");
});

prueba("B7. Aislamiento: B no ve ni cancela la operación de A", async () => {
    escenario();
    const abrir = puerta("g1@g.us");
    const r = await enviar({ solicitudId: sol() });
    assert.strictEqual((await progreso(r.json.operacion.id, "jwt-B")).status, 404);
    assert.strictEqual((await llamar("POST", `/tablas/compartir/operaciones/${r.json.operacion.id}/cancelar`, null, "jwt-B")).status, 404);
    assert.strictEqual((await llamar("GET", "/tablas/compartir/operaciones?precio=5000", null, "jwt-B")).json.data.activa, null);
    abrir();
    const d = await terminada(r.json.operacion.id);
    assert.strictEqual(d.estado, "completada");
});

prueba("B8. Cancelar antes de activar grupos nuevos: el publicador no se llama y el grupo queda pendiente sin recibir nada", async () => {
    escenario({ grupos: ["g1@g.us"] });
    fake.tablas.sorteos_programados_grupos.push({ id: "fila-n", usuario_id: A, sorteo_id: SORTEO, grupo_id: "g4@g.us", estado: "pendiente", intentos: 0, reintentos_manuales: 0, creado_en: "2026-10-22T11:09:00Z" });
    let abrirNav; nav.puerta = { p: new Promise(r => { abrirNav = r; }) };
    const r = await llamar("POST", "/tablas/compartir", { precio: 5000, solicitudId: sol(), asincrono: true, grupos: ["g4@g.us", "g1@g.us"] });
    await llamar("POST", `/tablas/compartir/operaciones/${r.json.operacion.id}/cancelar`);
    abrirNav();
    const d = await terminada(r.json.operacion.id);
    assert.strictEqual(llamadasNuevos.length, 0);
    assert.strictEqual(envios.length, 0);
    assert.deepStrictEqual(d.grupos.map(g => [g.grupo_id, g.estado]), [["g4@g.us", "cancelado"], ["g1@g.us", "cancelado"]]);
    assert.ok(/pendiente de publicar/.test(d.grupos[0].detalle));
    assert.strictEqual(fake.tablas.sorteos_programados_grupos.find(g => g.grupo_id === "g4@g.us").estado, "pendiente");
});

prueba("B9. Compartir no toca reservas, pagos, números, eventos ni grupos del sorteo", async () => {
    escenario();
    const antes = intocable();
    const r = await enviar({ solicitudId: sol() });
    await terminada(r.json.operacion.id);
    const abrir = puerta("g2@g.us");
    const c = await enviar({ solicitudId: sol() });
    await hasta(() => sim.llamadas.filter(x => x === "g2@g.us").length === 2);
    await llamar("POST", `/tablas/compartir/operaciones/${c.json.operacion.id}/cancelar`);
    abrir();
    await terminada(c.json.operacion.id);
    assert.strictEqual(intocable(), antes);
});

prueba("B10. Sin `asincrono` (panel anterior): misma respuesta de siempre, y queda registrada como operación", async () => {
    escenario();
    const r = await llamar("POST", "/tablas/compartir", { precio: 5000, solicitudId: sol(), imagen: PNG_DATA_URL, grupos: ["g1@g.us", "g2@g.us"] });
    assert.deepStrictEqual([r.status, r.json.enviado, r.json.enviados, r.json.fallidos], [200, true, 2, 0]);
    const d = (await progreso(r.json.operacion_id)).json.data;
    assert.deepStrictEqual([d.estado, d.totales.enviados], ["completada", 2]);
});

(async () => {
    const server = http.createServer(app);
    await new Promise(r => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${server.address().port}`;
    let ok = 0, falla = 0;
    for (const { nombre, fn } of pruebas) {
        const silencio = {}; for (const m of ["log", "error", "warn", "table", "dir", "info"]) { silencio[m] = console[m]; console[m] = () => {}; }
        try { await fn(); ok++; Object.assign(console, silencio); console.log(`✅ ${nombre}`); }
        catch (e) { falla++; Object.assign(console, silencio); console.log(`❌ ${nombre}`); console.log("   ", e && e.stack); }
        for (const pu of sim.puertas.values()) pu.abrir();
        if (nav.puerta) nav.puerta = null;
        await espera(20);
    }
    server.close();
    console.log(`\n============================\nTOTAL: ${ok + falla}  ✅ PASA: ${ok}  ❌ FALLA: ${falla}\n============================`);
    process.exit(falla ? 1 : 0);
})();
