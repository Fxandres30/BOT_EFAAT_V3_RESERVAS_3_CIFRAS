// ==========================================================================
// FASE O5 — SORTEOS PROGRAMADOS en MODO SOMBRA: publicación (anuncio con
// imagen), recordatorios y aviso de cierre.
//
// Mismo montaje que tests/sorteos/publicadorEstados.test.js y O0: reales
// servicio, publicador (con sus llamadas en sombra), destinosCompartir,
// compartirEnGrupos (con su llamada en sombra), executionGuard,
// guardarEvento, sorteos/sombraSorteos.js, services/sombraCompartir.js y
// shared/mensajes. Simulados: Supabase (memoria), socket y PNG.
//
//     node backend/tests/mensajes-o5/o5SorteosSombra.test.js
// ==========================================================================

"use strict";

process.env.GROUP_QUEUE_DELAY_MS = "0";
delete process.env.MENSAJES_ORQUESTADOR_SORTEO;

const assert = require("assert");
const path = require("path");
const { prueba, ejecutar } = require("../caracterizacion/_prueba");
const { crearFake } = require("../sorteos/fakeSupabaseSorteos");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);
const inyectar = (ruta, exp) => { require.cache[ruta] = { id: ruta, filename: ruta, loaded: true, exports: exp }; };

const prohibido = { chromium: 0 };
inyectar(require.resolve("puppeteer", { paths: [RAIZ] }), { launch: async () => { prohibido.chromium++; throw new Error("Chromium prohibido"); } });

let fake = crearFake();
const lecturas = [];
inyectar(r("lib/supabase.js"), {
    from: (t) => { lecturas.push(t); return fake.client.from(t); },
    auth: { getUser: (t) => fake.client.auth.getUser(t) },
    rpc: async () => ({ data: null, error: { code: "PGRST202", message: "sin RPC" } })
});

const servicio = require(r("sorteos/servicio.js"));
const publicador = require(r("sorteos/publicador.js"));
const destinos = require(r("services/destinosCompartir.js"));
const { compartirEnGrupos } = require(r("services/compartirTabla.js"));
const { ejecutarUnaVez } = require(r("automation/executionGuard.js"));
const { guardarEvento } = require(r("bot/funciones/eventos/guardarEvento.js"));
const { consultarEventoDelSorteo } = require(r("bot/funciones/eventos/consultarEvento.js"));
const { abrirGrupo } = require(r("bot/funciones/eventos/grupos/abrirGrupo.js"));
const { actualizarEvento } = require(r("bot/funciones/reservas/actualizarEvento.js"));
const { plantillaDe } = require(r("sorteos/estilosMensaje.js"));

const T0 = new Date("2026-10-15T15:00:00Z");
const PUBLICAR = new Date("2026-10-22T13:00:00Z");
const EN_PUBLICACION = new Date("2026-10-22T13:01:00Z");
const EN_RECORDATORIO = new Date("2026-10-23T02:31:00Z");
const TRAS_CIERRE = new Date("2026-10-23T03:05:00Z");
servicio._reloj.ahora = () => T0;

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const G = "573001112233-1111@g.us";
const T5K = "5k_15k_reservas_2_cifras";
const PNG = Buffer.from("png-simulado");
const DISENO = {
    theme: { pageBg: "#08090C", tableBg: "#0F1115", text: "#F2F5FA", border: "#20242C", accent: "#8B7BFF" },
    cells: { available: { bg: "#11141A", border: "#2A2F3A", text: "#E6E9EF" }, reserved: { bg: "#3A1F2B", border: "#E0567A", text: "#FFD9E3" }, pagado: { bg: "#123326", border: "#3DCB8F", text: "#D9FBEA" } },
    numbers: { size: 18, weight: 700 }, grid: { radius: 10, spacing: 6, borderWidth: 1 }
};

let enviados = [];
let capturas = 0;

function escenario({ modo = "shadow" } = {}) {
    if (modo) process.env.MENSAJES_ORQUESTADOR_SORTEO = modo; else delete process.env.MENSAJES_ORQUESTADOR_SORTEO;
    fake = crearFake();
    enviados = []; capturas = 0; lecturas.length = 0; prohibido.chromium = 0;
    const t = fake.tablas;
    t.grupos_autorizados = [{ usuario_id: A, grupo_id: G, activo: true }];
    t.grupos = [{ jid: G, nombre: "Pruebas" }];
    t.cuentas_pago = [{ id: "cuenta-a1", usuario_id: A, nombre: "Nequi A", tipo: "nequi", numero: "3000000001", titular: "A", activa: true }];
    t.eventos_bot = []; t.reservas_archivo = [];
    t[T5K] = Array.from({ length: 100 }, (_, i) => ({ numero: String(i).padStart(2, "0"), estado: "libre", usuario_id: A }));
}

const entrada = (extra = {}) => ({
    modalidad: "dos_cifras", nombre: "Lotería De Manizales", hora_fin: "22:30", hora_cierre: "22:00", valor: 3000,
    premios: [{ nombre: "Premio mayor", premio: 300000 }], grupos: [G], cuentas: ["cuenta-a1"],
    publicar_en: PUBLICAR.toISOString(), fecha_sorteo: "2026-10-22",
    mensajes: { publicacion: "📣 {{nombre}} · {{valor}} · {{fecha_larga}}", aviso_cierre: "🔒 Cerró {{nombre}}" },
    recordatorios: [{ minutos_antes_cierre: 30, texto: "⏰ {{nombre}} cierra a las {{hora_cierre}} · {{valor}}" }],
    diseno: { origen: "preset", nombre: "Morado", config: DISENO },
    ...extra
});

const deps = (cambios = {}) => ({
    supabase: { from: (t) => { lecturas.push(t); return fake.client.from(t); } },
    guardarEvento, consultarEventoDelSorteo, abrirGrupo, ejecutarUnaVez, actualizarEvento,
    puedeActuar: () => true,
    capturarImagen: async () => { capturas++; return PNG; },
    textoParaCompartir: destinos.textoParaCompartir,
    compartirEnGrupos,
    sendMessage: async ({ jid, text }) => { enviados.push({ jid, texto: text, tipo: "texto" }); return { key: { id: `t-${enviados.length}` } }; },
    leerEstadoParaRecordatorios: async () => ({ ok: true, total: 100, libres: 60, reservados: 10, grupoCerrado: false }),
    ...cambios
});

const sock = () => ({
    context: { usuarioId: A, sessionId: "ses-aaaa", telefono: "573000000000" },
    user: { id: "573000000000:1@s.whatsapp.net" },
    groupMetadata: async () => ({ subject: "Pruebas", participants: [{}], desc: null }),
    groupSettingUpdate: async () => {},
    sendMessage: async (jid, contenido) => {
        enviados.push({ jid, image: contenido.image, texto: contenido.caption ?? contenido.text, tipo: contenido.image ? "imagen" : "texto" });
        return { key: { id: `msg-${enviados.length}` } };
    }
});

// Un ciclo del publicador capturando la consola.
async function tick(ahora, d = deps()) {
    const capturadas = [];
    const { log, warn, error, table, dir } = console;
    console.log = console.warn = console.error = console.table = console.dir = (...a) => capturadas.push(a.map(x => (typeof x === "string" ? x : "")).join(" "));
    try { await publicador.tick(sock(), { ahora, deps: d }); } finally { Object.assign(console, { log, warn, error, table, dir }); }
    const crudas = capturadas.filter(l => l.startsWith("[MENSAJES SOMBRA]"));
    return { sombras: crudas.map(l => JSON.parse(l.slice(18))), crudas, todo: capturadas };
}

async function programar(datos = entrada()) {
    const { log, warn, error } = console;
    console.log = console.warn = console.error = () => {};
    try {
        const c = await servicio.crearSorteo(A, datos);
        assert.ok(c.ok, JSON.stringify(c));
        const conf = await servicio.confirmar(A, c.data.id, { version: c.data.version, confirmacion: true });
        assert.ok(conf.ok, JSON.stringify(conf));
        return conf.data;
    } finally { Object.assign(console, { log, warn, error }); }
}

const de = (sombras, tipo) => sombras.filter(s => s.tipo === tipo);
const accionesN = () => fake.tablas.automation_actions.length;

// ================================================================== off ===

prueba("O5S-1 sin la variable (off): mismos envíos y ninguna línea de sombra; la sombra no lee nada", async () => {
    escenario({ modo: null });
    await programar();
    const { sombras } = await tick(EN_PUBLICACION);
    assert.strictEqual(sombras.length, 0);
    assert.strictEqual(enviados.filter(e => e.tipo === "imagen").length, 1);
    const { compararSorteoEnSombra } = require(r("sorteos/sombraSorteos.js"));
    const leidas = [];
    const res = await compararSorteoEnSombra({ deps: { supabase: { from: (t) => { leidas.push(t); return fake.client.from(t); } } }, sorteo: { id: "x", usuario_id: A }, grupoId: G, tipo: "sorteo_aviso_cierre", sufijo: "aviso_cierre", texto: "x", r: { ejecutada: true }, entorno: {} });
    assert.deepStrictEqual([res.omitida, leidas.length], ["modo_off", 0]);
});

// ============================================================ publicación ===

prueba("O5S-2 publicación: imagen + pie de la COPIA del sorteo; la sombra genera el mismo texto SIN generar otra imagen", async () => {
    escenario();
    await programar();
    const { sombras } = await tick(EN_PUBLICACION);
    const anuncio = enviados.find(e => e.tipo === "imagen");
    assert.strictEqual(anuncio.texto, "📣 Lotería De Manizales · $3.000 · jueves 22 de octubre");
    const s = de(sombras, "sorteo_publicacion");
    assert.strictEqual(s.length, 1);
    assert.deepStrictEqual([s[0].coincide, s[0].origen, s[0].imagenGeneradaEnSombra, s[0].fuenteTexto.origen], [true, "sorteo", false, "sorteo"]);
    assert.strictEqual(capturas, 1, "una sola imagen: la del motor");
    assert.strictEqual(prohibido.chromium, 0);
});

prueba("O5S-3 cambiar después el estilo predeterminado de la cuenta no altera la publicación ni la comparación", async () => {
    escenario();
    await programar(entrada({ mensajes: { publicacion: "", aviso_cierre: "" } }));
    fake.tablas.preferencias_mensaje_sorteo = [{ usuario_id: A, estilo_predeterminado: "minimalista" }];
    const { sombras } = await tick(EN_PUBLICACION);
    const anuncio = enviados.find(e => e.tipo === "imagen");
    assert.ok(anuncio.texto.startsWith("🎉 *Lotería De Manizales* 🎉"), anuncio.texto);
    assert.strictEqual(fake.tablas.sorteos_programados[0].config.mensajes.publicacion, plantillaDe("clasico"));
    assert.strictEqual(de(sombras, "sorteo_publicacion")[0].coincide, true);
});

// ========================================================= recordatorios ===

prueba("O5S-4 recordatorio: la sombra relee la copia, genera el mismo texto (12 h, pesos) y verifica la clave del motor", async () => {
    escenario();
    const sorteo = await programar();
    await tick(EN_PUBLICACION);
    enviados = [];
    const { sombras } = await tick(EN_RECORDATORIO);
    const rec = enviados.find(e => e.texto?.startsWith("⏰"));
    assert.strictEqual(rec.texto, "⏰ Lotería De Manizales cierra a las 10:00 PM · $3.000");
    const s = de(sombras, "sorteo_recordatorio");
    assert.strictEqual(s.length, 1);
    assert.deepStrictEqual([s[0].coincide, s[0].clave.registradaPorElMotor, s[0].clave.estado, s[0].minutos, s[0].sorteoId], [true, true, "ok", 30, sorteo.id]);
});

prueba("O5S-5 envío único: el mismo recordatorio en el siguiente ciclo no se reenvía ni se vuelve a comparar", async () => {
    escenario();
    await programar();
    await tick(EN_PUBLICACION);
    await tick(EN_RECORDATORIO);
    enviados = [];
    const otra = await tick(new Date(EN_RECORDATORIO.getTime() + 60000));
    assert.strictEqual(enviados.filter(e => e.texto?.startsWith("⏰")).length, 0);
    assert.strictEqual(de(otra.sombras, "sorteo_recordatorio").length, 0);
});

// ========================================================= aviso de cierre ===

prueba("O5S-6 aviso de cierre propio → coincide; sin aviso propio el sorteo no envía (lo da el grupo) y no hay comparación", async () => {
    for (const aviso of ["🔒 Cerró {{nombre}}", ""]) {
        escenario();
        await programar(entrada({ mensajes: { publicacion: "x {{nombre}}", aviso_cierre: aviso } }));
        await tick(EN_PUBLICACION);
        Object.assign(fake.tablas.eventos_bot.find(e => e.grupo_id === G), { activo: false, estado: "cerrado" });
        enviados = [];
        const { sombras } = await tick(TRAS_CIERRE);
        const s = de(sombras, "sorteo_aviso_cierre");
        if (aviso) {
            assert.strictEqual(enviados.find(e => e.texto?.startsWith("🔒")).texto, "🔒 Cerró Lotería De Manizales");
            assert.strictEqual(s.length, 1);
            assert.strictEqual(s[0].coincide, true, JSON.stringify(s[0]));
        } else {
            // Sin aviso propio el cierre lo da la automatización del grupo: el sorteo no envía.
            assert.strictEqual(s.length, 0);
        }
    }
});

// ============================================================ cancelación ===

prueba("O5S-7 sorteo cancelado: sin recordatorios y sin comparaciones (la sombra no toca programaciones)", async () => {
    escenario();
    await programar();
    await tick(EN_PUBLICACION);
    const fila = fake.tablas.sorteos_programados[0];
    fila.estado = "cancelado";
    const antes = JSON.stringify(fake.tablas.sorteos_programados);
    enviados = [];
    const { sombras } = await tick(EN_RECORDATORIO);
    assert.strictEqual(enviados.filter(e => e.texto?.startsWith("⏰")).length, 0);
    assert.strictEqual(de(sombras, "sorteo_recordatorio").length, 0);
    assert.strictEqual(JSON.stringify(fake.tablas.sorteos_programados), antes);
});

// ============================================================ diferencias ===

prueba("O5S-8 diferencia real: la copia cambia entre el envío y la comparación → texto_distinto (el envío real no cambia)", async () => {
    escenario();
    await programar();
    await tick(EN_PUBLICACION);
    enviados = [];
    const d = deps({ sendMessage: async ({ jid, text }) => {
        fake.tablas.sorteos_programados[0].config.recordatorios[0].texto = "⏰ OTRO TEXTO";
        enviados.push({ jid, texto: text }); return { key: { id: "t" } };
    } });
    const { sombras } = await tick(EN_RECORDATORIO, d);
    assert.strictEqual(enviados[0].texto, "⏰ Lotería De Manizales cierra a las 10:00 PM · $3.000");
    assert.deepStrictEqual([de(sombras, "sorteo_recordatorio")[0].coincide, de(sombras, "sorteo_recordatorio")[0].motivo], [false, "texto_distinto"]);
});

// ===================================================== sin efectos y fallos ===

prueba("O5S-9 sin efectos: mismas acciones, eventos y programaciones con la sombra que sin ella", async () => {
    const huellaDe = async (modo) => {
        escenario({ modo });
        await programar();
        await tick(EN_PUBLICACION);
        await tick(EN_RECORDATORIO);
        const t = fake.tablas;
        return {
            acciones: t.automation_actions.map(a => [a.clave_idempotencia, a.estado]).sort(),
            programados: t.sorteos_programados.map(s => [s.id, s.estado, JSON.stringify(s.config)]),
            grupos: (t.sorteos_programados_grupos || []).map(g => [g.grupo_id, g.estado]),
            envios: enviados.map(e => [e.tipo, e.texto])
        };
    };
    const sinSombra = await huellaDe(null);
    const conSombra = await huellaDe("shadow");
    assert.deepStrictEqual(conSombra.acciones.length, sinSombra.acciones.length);
    assert.deepStrictEqual(conSombra.envios, sinSombra.envios);
    assert.deepStrictEqual(conSombra.programados.map(p => p[1]), sinSombra.programados.map(p => p[1]));
    assert.deepStrictEqual(conSombra.grupos, sinSombra.grupos);
});

prueba("O5S-10 si la sombra de sorteos falla por completo, el recordatorio se envía y se registra igual", async () => {
    escenario();
    await programar();
    await tick(EN_PUBLICACION);
    const ruta = r("sorteos/sombraSorteos.js");
    const original = require.cache[ruta];
    inyectar(ruta, { compararSorteoEnSombra: async () => { throw new Error("explotó (simulado)"); } });
    try {
        enviados = [];
        const antes = accionesN();
        const { todo } = await tick(EN_RECORDATORIO);
        assert.strictEqual(enviados.filter(e => e.texto?.startsWith("⏰")).length, 1);
        assert.strictEqual(accionesN(), antes + 1);
        assert.ok(todo.some(l => l.includes("comparación omitida")));
    } finally { if (original) require.cache[ruta] = original; else delete require.cache[ruta]; }
});

prueba("O5S-11 «active» configurado = solo sombra; la línea no contiene el JID del grupo", async () => {
    escenario({ modo: "active" });
    await programar();
    await tick(EN_PUBLICACION);
    enviados = [];
    const { sombras, crudas } = await tick(EN_RECORDATORIO);
    assert.strictEqual(enviados.filter(e => e.texto?.startsWith("⏰")).length, 1);
    const s = de(sombras, "sorteo_recordatorio")[0];
    assert.deepStrictEqual([s.orquestador.estado, Boolean(s.aviso)], ["sombra", true]);
    assert.ok(crudas.every(l => !l.includes("573001112233")));
});

ejecutar("O5 · Sorteos programados en modo sombra").finally(() => { delete process.env.MENSAJES_ORQUESTADOR_SORTEO; });
