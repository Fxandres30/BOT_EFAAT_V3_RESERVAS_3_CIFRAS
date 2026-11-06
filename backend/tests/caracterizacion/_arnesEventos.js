// ==========================================================================
// Arnés de las caracterizaciones de EVENTOS (C1, C2, C4).
//
// Mismo escenario que tests/automation/motorEventosUnico.test.js (ese archivo
// no se toca): cliente A, 3 grupos autorizados, automatización activa todo
// el día, pool de OPEN/CLOSE/REMINDER/UPDATE y la cuadrícula base de $3.000.
//
// Reales: detectarEvento, guardarEvento, abrirGrupo, groupQueue, sorteos/
// {servicio,publicador,repo}, compartirEnGrupos, automation/*, send.js.
// Simulados: Supabase (memoria), el socket de WhatsApp, la imagen y el
// escáner de identidades. Nunca toca Supabase real ni WhatsApp real.
//
// Duplicación conocida: este arnés repite el de motorEventosUnico. En F1-B
// se propone extraer uno común y que ambos lo usen.
// ==========================================================================

"use strict";

process.env.GROUP_QUEUE_DELAY_MS = "0";

// RELOJ FIJO: el detector (identidadEventoReal, guardarEvento) usa
// new Date() directamente. Sin fijarlo, el resultado dependería de la hora a
// la que se ejecute la prueba (p. ej. después del cierre de las 22:26).
// 22/10/2026 08:01 en Colombia: el día del sorteo, con el grupo abierto.
const RELOJ = new Date("2026-10-22T13:01:00Z").getTime();
const DateReal = Date;
global.Date = class extends DateReal {
    constructor(...a) { super(...(a.length ? a : [RELOJ])); }
    static now() { return RELOJ; }
};

const assert = require("assert");
const path = require("path");
const { crearFake } = require("../sorteos/fakeSupabaseSorteos");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);

const estado = { fake: crearFake(), enviados: [], operaciones: [], fallaApertura: () => false };

require.cache[r("lib/supabase.js")] = {
    id: r("lib/supabase.js"), filename: r("lib/supabase.js"), loaded: true,
    exports: {
        from: (t) => estado.fake.client.from(t),
        auth: { getUser: (t) => estado.fake.client.auth.getUser(t) },
        rpc: async () => ({ data: null, error: { code: "PGRST202", message: "sin RPC en esta prueba" } })
    }
};

require.cache[r("bot/funciones/usuarios/escanerIdentidadesLifecycle.js")] = {
    id: "escaner", filename: "escaner", loaded: true,
    exports: { escanearGrupo: async () => null, iniciarEscanerIdentidades: () => {}, detenerEscanerIdentidades: () => {}, escanearTodosLosGrupos: async () => null }
};

// send.js real espera 1-7 s («escribiendo...») antes de cada texto.
const setTimeoutOriginal = global.setTimeout;
global.setTimeout = (fn, _ms, ...args) => setTimeoutOriginal(fn, 0, ...args);

const servicio = require(r("sorteos/servicio.js"));
const publicador = require(r("sorteos/publicador.js"));
const destinos = require(r("services/destinosCompartir.js"));
const { compartirEnGrupos } = require(r("services/compartirTabla.js"));
const { ejecutarUnaVez } = require(r("automation/executionGuard.js"));
const { guardarEvento } = require(r("bot/funciones/eventos/guardarEvento.js"));
const { consultarEventoDelSorteo } = require(r("bot/funciones/eventos/consultarEvento.js"));
const { abrirGrupo } = require(r("bot/funciones/eventos/grupos/abrirGrupo.js"));
const { actualizarEvento } = require(r("bot/funciones/reservas/actualizarEvento.js"));
const { detectarEvento } = require(r("bot/funciones/eventos/detectarEvento.js"));
const scheduler = require(r("automation/scheduler.js"));
const motor = require(r("automation/motorEventos.js"));

const T0 = new Date("2026-10-15T15:00:00Z");
const PUBLICAR = new Date("2026-10-22T13:00:00Z");
const EN_PUBLICACION = new Date("2026-10-22T13:01:00Z");
servicio._reloj.ahora = () => T0;

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const T5K = "5k_15k_reservas_2_cifras";
const PNG = Buffer.from("png-simulado");
const GRUPOS = ["g1@g.us", "g2@g.us", "g3@g.us"];
const DISENO = {
    theme: { pageBg: "#08090C", tableBg: "#0F1115", text: "#F2F5FA", border: "#20242C", accent: "#8B7BFF" },
    cells: {
        available: { bg: "#11141A", border: "#2A2F3A", text: "#E6E9EF" },
        reserved: { bg: "#3A1F2B", border: "#E0567A", text: "#FFD9E3" },
        pagado: { bg: "#123326", border: "#3DCB8F", text: "#D9FBEA" }
    },
    numbers: { size: 18, weight: 700 },
    grid: { radius: 10, spacing: 6, borderWidth: 1 }
};
const TEXTO_APERTURA ="🔓 Grupo abierto: {nombre_evento} — valor {valor}";
const TEXTO_CIERRE = "🔒 Cerrado: {nombre_evento}";

function escenario() {
    estado.fake = crearFake();
    estado.enviados = [];
    estado.operaciones = [];
    estado.fallaApertura = () => false;
    const t = estado.fake.tablas;
    const todoElDia = { activo: true, desde: "00:00", hasta: "23:59" };
    const dias = Object.fromEntries(["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"].map(d => [d, todoElDia]));
    const todos = Object.fromEntries(Object.keys(dias).map(d => [d, true]));
    t.grupos_autorizados = GRUPOS.map(g => ({ usuario_id: A, grupo_id: g, activo: true }));
    t.grupos = GRUPOS.map((g, i) => ({ jid: g, nombre: `Grupo ${i + 1}` }));
    t.automation_configs = GRUPOS.map(g => ({
        id: `cfg-${g}`, usuario_id: A, grupo_id: g, activo: true, dias_permitidos: dias, mensaje_cierre: { activo: true },
        recordatorios: { 30: { activo: true } },
        publicacion_inicial_tabla: { activo: true, hora: "00:00", dias_permitidos: todos },
        mensaje_actualizacion: { activo: true }, umbral_reservas: 1, cooldown_minutos: 0
    }));
    t.automation_messages = [
        { id: "msg-open", usuario_id: A, tipo: "OPEN_MESSAGE", categoria: null, texto: TEXTO_APERTURA, activo: true, nombre_interno: "apertura" },
        { id: "msg-close", usuario_id: A, tipo: "CLOSE_MESSAGE", categoria: null, texto: TEXTO_CIERRE, activo: true, nombre_interno: "cierre" },
        { id: "msg-rem", usuario_id: A, tipo: "REMINDER_MESSAGE", categoria: null, texto: "⏰ General: {nombre_evento}", activo: true, nombre_interno: "recordatorio" },
        { id: "msg-upd", usuario_id: A, tipo: "UPDATE_MESSAGE", categoria: null, texto: "📈 Actualización: {nombre_evento}", activo: true, nombre_interno: "actualizacion" }
    ];
    t.automation_message_uses = [];
    t.event_sessions = [];
    t.automation_actions = [];
    t.cuentas_pago = [{ id: "cuenta-a1", usuario_id: A, nombre: "Nequi A", tipo: "nequi", numero: "3000000001", titular: "A", activa: true }];
    t.eventos_bot = [];
    t.reservas_archivo = [];
    t[T5K] = Array.from({ length: 100 }, (_, i) => ({ numero: String(i).padStart(2, "0"), estado: "libre", usuario_id: A }));
}

function entrada(extra = {}) {
    return {
        modalidad: "dos_cifras",
        nombre: "Antioqueñita Día",
        hora_fin: "22:30",
        valor: 3000,
        premios: [{ nombre: "Premio mayor", premio: 300000 }],
        grupos: ["g1@g.us"],
        cuentas: ["cuenta-a1"],
        publicar_en: PUBLICAR.toISOString(),
        fecha_sorteo: "2026-10-22",
        mensajes: { publicacion: "", aviso_cierre: "" },
        recordatorios: [],
        diseno: { origen: "preset", nombre: "Morado", config: DISENO },
        ...extra
    };
}

const sock = () => ({
    context: { usuarioId: A, sessionId: "ses-aaaa", telefono: "573000000000" },
    user: { id: "573000000000:1@s.whatsapp.net" },
    groupMetadata: async (jid) => ({ subject: `Nombre ${jid}`, participants: [{}, {}] }),
    groupSettingUpdate: async (jid, ajuste) => {
        if (ajuste === "not_announcement" && estado.fallaApertura(jid)) throw new Error("rate-overlimit simulado");
        estado.operaciones.push({ jid, ajuste });
    },
    sendPresenceUpdate: async () => {},
    sendMessage: async (jid, contenido) => {
        estado.enviados.push({ jid, tipo: contenido.image ? "imagen" : "texto", texto: contenido.caption ?? contenido.text });
        return { key: { id: `msg-${estado.enviados.length}` } };
    }
});

function deps(cambios = {}) {
    return {
        supabase: { from: (t) => estado.fake.client.from(t) },
        guardarEvento, consultarEventoDelSorteo, abrirGrupo, ejecutarUnaVez, actualizarEvento,
        puedeActuar: () => true,
        capturarImagen: async () => PNG,
        textoParaCompartir: destinos.textoParaCompartir,
        compartirEnGrupos,
        sendMessage: async () => { throw new Error("el anuncio nunca sale como texto"); },
        ...cambios
    };
}

// Reentrante: dos llamadas en paralelo (C2) no se pisan al restaurar console.
const consolaOriginal = { log: console.log, table: console.table, dir: console.dir, warn: console.warn, error: console.error };
let silencios = 0;
async function silencio(fn) {
    if (silencios++ === 0) console.log = console.table = console.dir = console.warn = console.error = () => {};
    try { return await fn(); } finally { if (--silencios === 0) Object.assign(console, consolaOriginal); }
}

async function drenar() {
    for (let i = 0; i < 40; i++) {
        if (motor.esperarEnvios) await motor.esperarEnvios();
        await new Promise(res => setImmediate(res));
    }
}

async function programar(datos) {
    const c = await silencio(() => servicio.crearSorteo(A, datos));
    assert.ok(c.ok, JSON.stringify(c));
    const conf = await silencio(() => servicio.confirmar(A, c.data.id, { version: c.data.version, confirmacion: true }));
    assert.ok(conf.ok, JSON.stringify(conf));
    return conf.data;
}

const tick = async (ahora, d = deps()) => { const x = await silencio(() => publicador.tick(sock(), { ahora, deps: d })); await silencio(drenar); return x; };

async function crearInstantaneo(datos) {
    servicio.instantaneo._socketDe = () => sock();
    servicio.instantaneo._deps = deps();
    const s = await silencio(() => servicio.crearSorteo(A, datos));
    assert.ok(s.ok, JSON.stringify(s));
    return s.data;
}
const publicarAhora = (s) => silencio(() => servicio.publicarAhora(A, s.id, { version: s.version, confirmacion: true }));

const ANUNCIO = "🎰 Antioqueñita Día - 10:30 PM\n\n🍀 Dos últimas cifras → $300.000\n\n🎯 Valor número: $3.000\n\n🏦 Nequi\n📲 3000000001";
const contextoDeteccion = (grupoId, texto = ANUNCIO) => ({ sock: sock(), grupo: { remoteJid: grupoId }, chat: { remoteJid: grupoId, esGrupo: true }, textoOriginal: texto, session: { usuarioId: A } });
const detectar = (grupoId, texto) => silencio(() => detectarEvento(contextoDeteccion(grupoId, texto)));

const filtrar = (prefijo) => (g) => estado.enviados.filter(e => e.tipo === "texto" && e.texto?.startsWith(prefijo) && (!g || e.jid === g));
const aperturas = filtrar("🔓 Grupo abierto");
const cierres = filtrar("🔒 Cerrado");
const anuncios = (g) => estado.enviados.filter(e => e.tipo === "imagen" && (!g || e.jid === g));
const eventosDe = (g) => estado.fake.tablas.eventos_bot.filter(e => e.grupo_id === g);
const sesionesDe = (g) => estado.fake.tablas.event_sessions.filter(s => s.grupo_id === g);

module.exports = {
    estado, escenario, entrada, sock, deps, silencio, drenar, programar, tick, crearInstantaneo, publicarAhora,
    detectar, contextoDeteccion, detectarEvento, aperturas, cierres, anuncios, eventosDe, sesionesDe,
    servicio, publicador, scheduler, motor, A, T5K, GRUPOS, T0, PUBLICAR, EN_PUBLICACION, ANUNCIO,
    restaurarTemporizadores: () => { global.setTimeout = setTimeoutOriginal; global.Date = DateReal; }
};
