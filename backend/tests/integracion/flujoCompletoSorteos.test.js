// ==========================================================================
// PRUEBA INTEGRAL — EFAAT como UN sistema (04/11/2026): sorteos del panel
// (instantáneo y programado), grupos (Cambiar grupos / Editar / quitar /
// publicar en los nuevos / reintentar), tablas, reservas, pagos y el motor de
// automatizaciones (apertura, tabla inicial, recordatorios, actualizaciones
// y cierre) funcionando JUNTOS, con su prioridad sorteo > grupo.
//
// Reales: sorteos/{servicio,publicador,gruposSorteo,sorteosActivos,
// gestionEventos,repo}.js, automation/{motorEventos,engine,scheduler,
// eventRules,executionGuard,prioridadComunicaciones,repo/*},
// workerEventos, verificarHoraCierre, guardarEvento, consultarEvento,
// abrirGrupo, compartirEnGrupos, services/baileys/send.js, reservarNumeros,
// services/reservaManual (pagos). Simulados: Supabase (memoria), el socket de
// WhatsApp y la captura de la imagen. Nada real se toca ni se envía.
//
// Escenario 8 (reinicio): los datos se vuelcan a disco y un PROCESO NUEVO de
// Node, con todos los módulos cargados desde cero, sigue el ciclo.
//
//     node backend/tests/integracion/flujoCompletoSorteos.test.js
// ==========================================================================

process.env.GROUP_QUEUE_DELAY_MS = "0";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { crearFake } = require("../sorteos/fakeSupabaseSorteos");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);
const HIJO = process.argv[2] === "--reinicio";
const VOLCADO = process.argv[3] || path.join(os.tmpdir(), `efaat-integral-${process.pid}.json`);

let fake = crearFake();
require.cache[r("lib/supabase.js")] = {
    id: r("lib/supabase.js"), filename: r("lib/supabase.js"), loaded: true,
    exports: {
        from: (t) => fake.client.from(t),
        auth: { getUser: (t) => fake.client.auth.getUser(t) },
        rpc: async () => ({ data: null, error: { code: "PGRST202", message: "sin RPC en esta prueba" } })
    }
};
require.cache[r("bot/funciones/usuarios/escanerIdentidadesLifecycle.js")] = {
    id: "escaner", filename: "escaner", loaded: true,
    exports: { escanearGrupo: async () => null, iniciarEscanerIdentidades: () => {}, detenerEscanerIdentidades: () => {}, escanearTodosLosGrupos: async () => null }
};
// send.js real espera 1-7 s («escribiendo...»): sin esperas en la prueba.
const setTimeoutOriginal = global.setTimeout;
global.setTimeout = (fn, _ms, ...args) => setTimeoutOriginal(fn, 0, ...args);

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const T3K = "5k_15k_reservas_2_cifras";   // $3.000
const GRUPOS = ["g1@g.us", "g2@g.us", "g3@g.us", "g4@g.us"];
const PNG = Buffer.from("png-simulado");

let enviados = [];
let falla = { envio: () => null, apertura: () => false };
const sock = () => ({
    context: { usuarioId: A, sessionId: "ses-aaaa", telefono: "573000000000" },
    user: { id: "573000000000:1@s.whatsapp.net" },
    groupMetadata: async (jid) => ({ subject: `Nombre ${jid}`, participants: [{}, {}] }),
    groupSettingUpdate: async (jid, ajuste) => { if (ajuste === "not_announcement" && falla.apertura(jid)) throw new Error("rate-overlimit simulado"); },
    sendPresenceUpdate: async () => {},
    sendMessage: async (jid, contenido) => {
        const e = falla.envio(jid);
        if (e) throw new Error(e);
        enviados.push({ jid, tipo: contenido.image ? "imagen" : "texto", texto: contenido.caption ?? contenido.text });
        return { key: { id: `msg-${enviados.length}` } };
    }
});
require.cache[r("services/baileys/manager.js")] = {
    id: "manager", filename: "manager", loaded: true,
    exports: { getSocketActivoDe: (u) => (u === A ? sock() : null), getSocketsActivos: () => [sock()] }
};

const servicio = require(r("sorteos/servicio.js"));
const publicador = require(r("sorteos/publicador.js"));
const gruposSorteo = require(r("sorteos/gruposSorteo.js"));
const sorteosActivos = require(r("sorteos/sorteosActivos.js"));
const scheduler = require(r("automation/scheduler.js"));
const motor = require(r("automation/motorEventos.js"));
const { workerEventos } = require(r("bot/funciones/eventos/workers/workerEventos.js"));
const { consultarEvento } = require(r("bot/funciones/eventos/consultarEvento.js"));
const { reservarNumerosDetallado } = require(r("bot/funciones/reservas/reservarNumeros.js"));
const reservaManual = require(r("services/reservaManual.js"));

const deps = () => ({ ...publicador.dependenciasReales(), supabase: { from: (t) => fake.client.from(t) }, puedeActuar: () => true, capturarImagen: async () => PNG });
servicio.instantaneo._socketDe = (u) => (u === A ? sock() : null);
gruposSorteo.deps.socketDe = (u) => (u === A ? sock() : null);
gruposSorteo.deps.puedeActuar = () => true;
const usarDeps = () => { const d = deps(); servicio.instantaneo._deps = d; gruposSorteo.deps.publicadorDeps = d; return d; };

// Jueves 22/10/2026. Cierre del sorteo 22:26 (Colombia) = 03:26Z del 23.
const AHORA = new Date("2026-10-22T15:00:00Z");            // 10:00
const LUEGO = new Date("2026-10-22T15:20:00Z");
const RECORDATORIO = new Date("2026-10-23T02:27:00Z");     // 21:27: 60 min antes del cierre
const TRAS_CIERRE = new Date("2026-10-23T03:30:00Z");      // 22:30
servicio._reloj.ahora = () => AHORA;
gruposSorteo.reloj.ahora = () => LUEGO;

const silencio = async (fn) => {
    const { log, table, dir, warn, error, info } = console;
    console.log = console.table = console.dir = console.warn = console.error = console.info = () => {};
    try { return await fn(); } finally { Object.assign(console, { log, table, dir, warn, error, info }); }
};
async function drenar() { for (let i = 0; i < 40; i++) { await motor.esperarEnvios(); await new Promise(res => setImmediate(res)); } }
const ciclo = async (ahora, d = usarDeps()) => silencio(async () => {
    await publicador.tick(sock(), { ahora, deps: d });
    await drenar();
    await workerEventos(sock(), { ahora });
    await drenar();
    await scheduler.tick(sock(), { ahora });
    await drenar();
});

// ---------------------------------------------------------------- datos ---
function escenario({ horario = { desde: "00:00", hasta: "23:59" } } = {}) {
    fake = crearFake();
    enviados = [];
    falla = { envio: () => null, apertura: () => false };
    const t = fake.tablas;
    const dia = { activo: true, ...horario };
    const dias = Object.fromEntries(["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"].map(d => [d, dia]));
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
        { id: "m-open", usuario_id: A, tipo: "OPEN_MESSAGE", categoria: null, texto: "🔓 Grupo abierto: {nombre_evento}", activo: true, nombre_interno: "apertura" },
        { id: "m-close", usuario_id: A, tipo: "CLOSE_MESSAGE", categoria: null, texto: "🔒 Cerrado (grupo): {nombre_evento}", activo: true, nombre_interno: "cierre" },
        { id: "m-rem", usuario_id: A, tipo: "REMINDER_MESSAGE", categoria: null, texto: "⏰ General: {nombre_evento}", activo: true, nombre_interno: "recordatorio" },
        { id: "m-upd", usuario_id: A, tipo: "UPDATE_MESSAGE", categoria: null, texto: "📈 Actualización: {nombre_evento}", activo: true, nombre_interno: "actualizacion" }
    ];
    t.automation_message_uses = [];
    t.event_sessions = [];
    t.automation_actions = [];
    t.cuentas_pago = [{ id: "cuenta-a1", usuario_id: A, nombre: "Nequi A", tipo: "nequi", numero: "3000000001", titular: "A", activa: true }];
    t.eventos_bot = [];
    t.reservas_archivo = [];
    t[T3K] = Array.from({ length: 100 }, (_, i) => ({ id: `n-${i}`, numero: String(i).padStart(2, "0"), estado: "libre", usuario_id: A }));
}

const DISENO = {
    theme: { pageBg: "#08090C", tableBg: "#0F1115", text: "#F2F5FA", border: "#20242C", accent: "#8B7BFF" },
    cells: { available: { bg: "#11141A", border: "#2A2F3A", text: "#E6E9EF" }, reserved: { bg: "#3A1F2B", border: "#E0567A", text: "#FFD9E3" }, pagado: { bg: "#123326", border: "#3DCB8F", text: "#D9FBEA" } },
    numbers: { size: 18, weight: 700 }, grid: { radius: 10, spacing: 6, borderWidth: 1 }
};
const entrada = (extra = {}) => ({
    modalidad: "dos_cifras", nombre: "Sorteo A", hora_fin: "22:30", valor: 3000,
    premios: [{ nombre: "Premio mayor", premio: 300000 }], grupos: ["g1@g.us", "g2@g.us", "g3@g.us"], cuentas: ["cuenta-a1"],
    publicacion_inmediata: true, fecha_sorteo: "2026-10-22",
    // Del sorteo: un recordatorio y su aviso de cierre (prioridad sobre los del grupo).
    mensajes: { publicacion: "", aviso_cierre: "🔔 Cierre del sorteo A" },
    recordatorios: [{ minutos_antes_cierre: 60, texto: "⏰ Del sorteo: quedan pocos números" }],
    diseno: { origen: "preset", nombre: "Morado", config: DISENO },
    ...extra
});

// ------------------------------------------------------------- lecturas ---
const de = (g, f) => enviados.filter(e => (!g || e.jid === g) && f(e));
const anuncios = (g) => de(g, e => e.tipo === "imagen").length;
const aperturas = (g) => de(g, e => e.texto?.startsWith("🔓 Grupo abierto")).length;
const recSorteo = (g) => de(g, e => e.texto?.startsWith("⏰ Del sorteo")).length;
const recGeneral = (g) => de(g, e => e.texto?.startsWith("⏰ General")).length;
const actualizaciones = (g) => de(g, e => e.texto?.startsWith("📈 Actualización")).length;
const cierreGrupo = (g) => de(g, e => e.texto?.startsWith("🔒 Cerrado (grupo)")).length;
const cierreSorteo = (g) => de(g, e => e.texto?.startsWith("🔔 Cierre del sorteo")).length;
const total = (g) => de(g, () => true).length;
const t = () => fake.tablas;
const prog = () => t().sorteos_programados[0];
const ev = (g) => t().eventos_bot.filter(e => e.identidad_evento_real === prog().identidad_evento_real && e.grupo_id === g);
const ciclos = (g) => t().event_sessions.filter(s => s.grupo_id === g);
const fila = (n) => t()[T3K].find(f => f.numero === n);

async function instantaneoEn(grupos, extra = {}) {
    usarDeps();
    const c = await silencio(() => servicio.crearSorteo(A, entrada({ grupos, ...extra })));
    assert.ok(c.ok, JSON.stringify(c));
    const p = await silencio(() => servicio.publicarAhora(A, c.data.id, { version: c.data.version, confirmacion: true }));
    await silencio(drenar);
    assert.ok(p.ok, JSON.stringify(p));
    return { s: prog(), res: p.data };
}
async function reservar(g, n, tel = "573111111111") {
    const evento = await consultarEvento(g, A);
    const r1 = await silencio(() => reservarNumerosDetallado({ evento, numeros: [n], usuario: { telefono: tel }, comprador: `C${n}`, contacto: tel }));
    return { evento, filas: r1.filas };
}

// ------------------------------------------------------------- pruebas ---
const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

prueba("1. Instantáneo publicado en tres grupos: un anuncio, UNA apertura y un ciclo abierto por grupo; el mismo sorteo y la misma tabla", async () => {
    escenario();
    const { s, res } = await instantaneoEn(["g1@g.us", "g2@g.us", "g3@g.us"]);
    assert.deepStrictEqual([res.publicados, s.estado], [3, "publicado"]);
    for (const g of ["g1@g.us", "g2@g.us", "g3@g.us"]) {
        assert.deepStrictEqual([anuncios(g), aperturas(g)], [1, 1], g);
        assert.ok(ev(g).length === 1 && ev(g)[0].activo && ev(g)[0].tabla === T3K, g);
        assert.ok(ciclos(g).length === 1 && ciclos(g)[0].estado === "abierto", g);
    }
    assert.strictEqual(total("g4@g.us"), 0);
    // El ciclo no duplica la tabla inicial (el anuncio ya la publicó).
    await ciclo(LUEGO);
    assert.ok(["g1@g.us", "g2@g.us", "g3@g.us"].every(g => anuncios(g) === 1 && aperturas(g) === 1), JSON.stringify(enviados.map(e => [e.jid, e.texto?.slice(0, 20)])));
});

prueba("2. Programado: nada antes de su hora; a su hora se publica en sus grupos (anuncio + apertura una vez)", async () => {
    escenario();
    usarDeps();
    const c = await silencio(() => servicio.crearSorteo(A, entrada({ publicacion_inmediata: false, publicar_en: "2026-10-22T15:10:00Z", grupos: ["g1@g.us", "g2@g.us"] })));
    assert.ok(c.ok, JSON.stringify(c));
    const conf = await silencio(() => servicio.confirmar(A, c.data.id, { version: c.data.version, confirmacion: true }));
    assert.ok(conf.ok, JSON.stringify(conf));
    await ciclo(new Date("2026-10-22T15:05:00Z"));
    assert.strictEqual(enviados.length, 0, "antes de su hora no sale nada");
    await ciclo(new Date("2026-10-22T15:10:30Z"));
    await ciclo(new Date("2026-10-22T15:11:00Z"));
    assert.deepStrictEqual(["g1@g.us", "g2@g.us"].map(g => [anuncios(g), aperturas(g)]), [[1, 1], [1, 1]]);
    assert.strictEqual(prog().estado, "publicado");
});

prueba("3-5, 9-11, 14-15. Agregar por «Cambiar grupos» y por «Editar», publicar SOLO en los nuevos; reservas y pagos desde cada grupo en la MISMA tabla; los publicados no reciben nada más", async () => {
    escenario();
    const { s } = await instantaneoEn(["g1@g.us", "g2@g.us"]);
    const base12 = [total("g1@g.us"), total("g2@g.us")];
    // 3. «Cambiar grupos» (la función que usan las rutas de Tablas).
    const c = await silencio(() => gruposSorteo.cambiarGrupos(A, s.id, ["g1@g.us", "g2@g.us", "g3@g.us"], { origen: "tablas" }));
    assert.ok(c.ok && c.data.por_publicar === 1, JSON.stringify(c));
    // 14. Guardar no publica, ni el ciclo automático tampoco.
    await ciclo(LUEGO);
    assert.strictEqual(total("g3@g.us"), 0, "guardar no publica");
    // 5. Publicar SOLO en los nuevos.
    const p3 = await silencio(() => gruposSorteo.publicarGruposNuevos(A, s.id));
    await silencio(drenar);
    assert.ok(p3.ok && p3.data.publicados_ahora[0] === "g3@g.us", JSON.stringify(p3));
    assert.deepStrictEqual([anuncios("g3@g.us"), aperturas("g3@g.us")], [1, 1], "Grupo 3: anuncio y apertura una vez");
    // 4. «Editar» del sorteo activo agrega el Grupo 4 y cambia un premio.
    const e1 = ev("g1@g.us")[0];
    const v = await silencio(() => sorteosActivos.obtener(A, e1.id));
    const ed = await silencio(() => sorteosActivos.editar(A, e1.id, { grupos: ["g1@g.us", "g2@g.us", "g3@g.us", "g4@g.us"], premios: [{ nombre: "Premio mayor", premio: 350000 }], base: { premios: v.data.premios, hora_cierre: v.data.hora_cierre } }));
    assert.ok(ed.ok, JSON.stringify(ed));
    await ciclo(LUEGO);
    assert.strictEqual(total("g4@g.us"), 0, "la edición no publica");
    await silencio(() => gruposSorteo.publicarGruposNuevos(A, s.id));
    await silencio(drenar);
    assert.deepStrictEqual([anuncios("g4@g.us"), aperturas("g4@g.us")], [1, 1]);
    // 15. Los ya publicados no recibieron NADA por agregar, editar o publicar.
    assert.deepStrictEqual([total("g1@g.us"), total("g2@g.us")], base12, "Grupos 1 y 2 sin mensajes adicionales");
    assert.strictEqual(anuncios("g3@g.us"), 1);
    // Una tabla = un sorteo: los cuatro grupos, la misma identidad y tabla.
    assert.deepStrictEqual(GRUPOS.map(g => ev(g).length), [1, 1, 1, 1]);
    assert.ok(GRUPOS.every(g => ev(g)[0].tabla === T3K && ev(g)[0].activo));
    assert.strictEqual(t().sorteos_programados.length, 1);
    // 9-10. Reservas desde cada grupo, en la misma tabla.
    for (const [g, n] of [["g1@g.us", "11"], ["g2@g.us", "22"], ["g3@g.us", "33"], ["g4@g.us", "44"]]) {
        const rr = await reservar(g, n);
        assert.strictEqual(rr.filas.length, 1, `${g} acepta la reserva`);
        assert.deepStrictEqual([fila(n).estado, fila(n).identidad_evento_real, fila(n).grupo_id], ["reservado", s.identidad_evento_real, g]);
    }
    assert.strictEqual((await reservar("g4@g.us", "11", "573999999999")).filas.length, 0, "el 11 (Grupo 1) está ocupado para el Grupo 4");
    // 11. Pago desde el panel del número reservado en el Grupo 3.
    const pago = await silencio(() => reservaManual.pagarManual({ usuarioId: A, operador: { id: "op", email: "op@x" }, precio: 3000, numero: "33", solicitudId: "pago-33" }));
    assert.ok(pago.ok, JSON.stringify(pago));
    assert.deepStrictEqual([fila("33").estado, fila("33").identidad_evento_real, fila("33").grupo_id], ["pagado", s.identidad_evento_real, "g3@g.us"], "el pago queda en su sorteo y su grupo");
    assert.strictEqual(t()[T3K].length, 100, "la tabla no se regeneró");
});

prueba("6, 12-13. Quitar un grupo: desactivado solo ahí, su ciclo termina SIN cierre; no recibe recordatorios, actualizaciones ni cierre; recordatorio y cierre del sorteo una vez en los demás (prioridad sobre los del grupo)", async () => {
    escenario();
    const { s } = await instantaneoEn(["g1@g.us", "g2@g.us", "g3@g.us"]);
    await reservar("g2@g.us", "07");
    const pago = await silencio(() => reservaManual.pagarManual({ usuarioId: A, operador: { id: "op", email: "op@x" }, precio: 3000, numero: "07", solicitudId: "pago-07" }));
    assert.ok(pago.ok, JSON.stringify(pago));
    const historia = JSON.stringify([fila("07"), t().sorteos_programados_grupos.find(x => x.grupo_id === "g2@g.us").publicado_en]);
    const q = await silencio(() => gruposSorteo.cambiarGrupos(A, s.id, ["g1@g.us", "g3@g.us"], { origen: "tablas" }));
    assert.ok(q.ok && q.data.desactivados[0].grupo_id === "g2@g.us", JSON.stringify(q));
    const antesG2 = total("g2@g.us");
    await ciclo(LUEGO);
    assert.ok(["cerrado", "expirado"].includes(ciclos("g2@g.us")[0].estado), `ciclo del grupo quitado terminado (${ciclos("g2@g.us")[0].estado})`);
    assert.strictEqual(ciclos("g1@g.us")[0].estado, "abierto");
    // Movimiento de reservas y hora del recordatorio, dos veces (idempotencia).
    await reservar("g1@g.us", "15");
    await ciclo(RECORDATORIO);
    await ciclo(new Date(RECORDATORIO.getTime() + 60 * 1000));
    assert.deepStrictEqual(["g1@g.us", "g3@g.us"].map(recSorteo), [1, 1], "recordatorio del sorteo una vez por grupo activo");
    assert.deepStrictEqual(["g1@g.us", "g3@g.us"].map(recGeneral), [0, 0], "sin recordatorio general: el sorteo tiene los suyos");
    // Cierre por la hora (lifecycle real del worker), dos ciclos.
    await ciclo(TRAS_CIERRE);
    await ciclo(new Date(TRAS_CIERRE.getTime() + 60 * 1000));
    assert.deepStrictEqual(["g1@g.us", "g3@g.us"].map(cierreSorteo), [1, 1], "aviso de cierre del sorteo una vez");
    assert.deepStrictEqual(["g1@g.us", "g3@g.us"].map(cierreGrupo), [0, 0], "nunca dos avisos de cierre (el del grupo no se suma)");
    // El grupo quitado no recibió nada más.
    assert.strictEqual(total("g2@g.us"), antesG2, `Grupo 2 sin mensajes nuevos: ${JSON.stringify(de("g2@g.us", () => true).slice(antesG2))}`);
    assert.deepStrictEqual([recSorteo("g2@g.us"), actualizaciones("g2@g.us"), cierreSorteo("g2@g.us"), cierreGrupo("g2@g.us")], [0, 0, 0, 0]);
    assert.strictEqual(JSON.stringify([fila("07"), t().sorteos_programados_grupos.find(x => x.grupo_id === "g2@g.us").publicado_en]), historia, "reserva pagada y publicación del Grupo 2 intactas");
    // 12. Aperturas: una por grupo durante todo el ciclo.
    assert.deepStrictEqual(["g1@g.us", "g2@g.us", "g3@g.us"].map(aperturas), [1, 1, 1]);
});

prueba("7. Reintentar un grupo que falló: solo ese grupo, una vez; los publicados no reciben nada", async () => {
    escenario();
    falla.envio = (jid) => (jid === "g3@g.us" ? "not-authorized (simulado)" : null);
    const { s, res } = await instantaneoEn(["g1@g.us", "g2@g.us", "g3@g.us"]);
    assert.deepStrictEqual([res.publicados, res.en_revision], [2, 1]);
    const base12 = [total("g1@g.us"), total("g2@g.us")];
    falla.envio = () => null;
    const re = await silencio(() => servicio.reintentarGrupo(A, s.id, "g3@g.us"));
    await silencio(drenar);
    assert.ok(re.ok, JSON.stringify(re));
    await silencio(() => servicio.reintentarGrupo(A, s.id, "g3@g.us"));
    await ciclo(LUEGO);
    assert.deepStrictEqual([anuncios("g3@g.us"), aperturas("g3@g.us")], [1, 1]);
    assert.deepStrictEqual([total("g1@g.us"), total("g2@g.us")], base12);
});

prueba("16. Reglas y horarios: fuera del horario permitido no hay apertura ni ciclo; tras el cierre no se publica; un grupo no autorizado no se puede asociar", async () => {
    escenario({ horario: { desde: "00:00", hasta: "00:30" } });
    const { s } = await instantaneoEn(["g1@g.us"]);
    await ciclo(LUEGO);
    assert.strictEqual(aperturas("g1@g.us"), 0, "fuera del horario de la automatización: sin apertura");
    assert.ok(!ciclos("g1@g.us").some(c => c.estado === "abierto"), "sin ciclo abierto");
    // Grupo no autorizado.
    t().grupos_autorizados = t().grupos_autorizados.map(g => (g.grupo_id === "g4@g.us" ? { ...g, activo: false } : g));
    const na = await silencio(() => gruposSorteo.cambiarGrupos(A, s.id, ["g1@g.us", "g4@g.us"]));
    assert.deepStrictEqual([na.ok, na.motivo], [false, "destinos_no_disponibles"]);
    // Un grupo agregado después del cierre no se publica.
    await silencio(() => gruposSorteo.cambiarGrupos(A, s.id, ["g1@g.us", "g2@g.us"]));
    gruposSorteo.reloj.ahora = () => TRAS_CIERRE;
    try {
        const p = await silencio(() => gruposSorteo.publicarGruposNuevos(A, s.id));
        assert.ok(p.ok, JSON.stringify(p));
        assert.strictEqual(total("g2@g.us"), 0, "tras el cierre no se publica");
        assert.strictEqual(t().sorteos_programados_grupos.find(x => x.grupo_id === "g2@g.us").estado, "requiere_revision");
    } finally { gruposSorteo.reloj.ahora = () => LUEGO; }
});

prueba("Detectado por WhatsApp → «Gestionar desde el panel» → grupo nuevo: MISMA identidad, tabla y reservas; el grupo original no recibe nada; el nuevo, anuncio + apertura una vez; el detector sigue tratándolo como de WhatsApp", async () => {
    escenario();
    usarDeps();
    const { detectarEvento } = require(r("bot/funciones/eventos/detectarEvento.js"));
    const ANUNCIO = "🎰 Antioqueñita Día - 10:30 PM\n\n🍀 Dos últimas cifras → $300.000\n\n🎯 Valor número: $3.000\n\n🏦 Nequi\n📲 3000000001";
    const detectar = (g) => silencio(async () => { const x = await detectarEvento({ sock: sock(), grupo: { remoteJid: g }, chat: { remoteJid: g, esGrupo: true }, textoOriginal: ANUNCIO, session: { usuarioId: A } }); await drenar(); return x; });
    const e1 = await detectar("g1@g.us");
    assert.ok(e1?.id && e1.activo, JSON.stringify(e1));
    assert.strictEqual(aperturas("g1@g.us"), 1, "apertura de la detección");
    const identidad = e1.identidad_evento_real;
    assert.strictEqual((await reservar("g1@g.us", "05")).filas.length, 1);
    const antesG1 = total("g1@g.us");
    const filasAntes = t().eventos_bot.length;
    const reservasAntes = JSON.stringify(t()[T3K].filter(f => f.estado !== "libre"));
    // Sin cuentas no se puede (el anuncio del grupo nuevo las necesita).
    const sin = await silencio(() => gruposSorteo.vincularSorteoDetectado(A, e1.id, { cuentas: [] }));
    assert.deepStrictEqual([sin.ok, sin.motivo], [false, "validacion"]);
    // Vincular: crea SU programación con la misma identidad; nada se envía.
    const v1 = await silencio(() => gruposSorteo.vincularSorteoDetectado(A, e1.id, { cuentas: ["cuenta-a1"] }));
    assert.ok(v1.ok && !v1.data.ya_existia, JSON.stringify(v1));
    const v2 = await silencio(() => gruposSorteo.vincularSorteoDetectado(A, e1.id, { cuentas: ["cuenta-a1"] }));
    assert.ok(v2.ok && v2.data.ya_existia && v2.data.sorteo_programado_id === v1.data.sorteo_programado_id, "idempotente");
    const p = t().sorteos_programados.find(x => x.id === v1.data.sorteo_programado_id);
    assert.deepStrictEqual([p.identidad_evento_real, p.tabla, p.estado, p.config.origen, p.config.recordatorios.length, p.config.mensajes.aviso_cierre, p.config.reservas.liberar_no_pagados], [identidad, T3K, "publicado", "whatsapp", 0, "", false]);
    assert.deepStrictEqual(t().sorteos_programados_grupos.filter(g => g.sorteo_id === p.id).map(g => [g.grupo_id, g.estado, g.evento_bot_id]), [["g1@g.us", "publicado", e1.id]]);
    assert.strictEqual(t().eventos_bot.length, filasAntes, "no se crea ni se toca ningún evento");
    assert.strictEqual(JSON.stringify(t()[T3K].filter(f => f.estado !== "libre")), reservasAntes, "reservas intactas");
    assert.strictEqual(total("g1@g.us"), antesG1, "vincular no envía nada");
    // Agregar el Grupo 2 y publicar SOLO ahí.
    const c = await silencio(() => gruposSorteo.cambiarGrupos(A, p.id, ["g1@g.us", "g2@g.us"]));
    assert.ok(c.ok && c.data.por_publicar === 1, JSON.stringify(c));
    const pub = await silencio(() => gruposSorteo.publicarGruposNuevos(A, p.id));
    await silencio(drenar);
    assert.ok(pub.ok && pub.data.publicados_ahora[0] === "g2@g.us", JSON.stringify(pub));
    assert.deepStrictEqual([anuncios("g2@g.us"), aperturas("g2@g.us")], [1, 1], "Grupo 2: anuncio con imagen y apertura una vez");
    const anuncio2 = de("g2@g.us", e => e.tipo === "imagen")[0].texto;
    assert.ok(/Nequi A/.test(anuncio2) && /3\.000/.test(anuncio2), anuncio2);
    const e2 = t().eventos_bot.find(e => e.grupo_id === "g2@g.us" && e.identidad_evento_real === identidad);
    assert.ok(e2?.activo && e2.tabla === T3K, "mismo sorteo y misma tabla en el Grupo 2");
    assert.strictEqual(total("g1@g.us"), antesG1, "el grupo original no recibe nada");
    assert.strictEqual((await reservar("g2@g.us", "05", "573999999999")).filas.length, 0, "el 05 del Grupo 1 está ocupado en el Grupo 2");
    assert.strictEqual((await reservar("g2@g.us", "20")).filas.length, 1, "el Grupo 2 acepta reservas");
    // El detector sigue tratándolo como de WhatsApp: el re-anuncio en el
    // Grupo 1 se procesa como siempre (misma fila, sin otro sorteo).
    const { esEventoDeSorteoProgramado } = require(r("sorteos/repo.js"));
    assert.strictEqual(await esEventoDeSorteoProgramado(t().eventos_bot.find(e => e.id === e1.id)), false);
    const re = await detectar("g1@g.us");
    assert.strictEqual(re?.id, e1.id, "el re-anuncio es el mismo evento");
    assert.strictEqual(t().eventos_bot.filter(e => e.identidad_evento_real === identidad).length, 2, "una fila por grupo, sin duplicados");
    assert.strictEqual(aperturas("g1@g.us"), 1, "el re-anuncio no repite la apertura");
    // Sin recordatorios ni cierre propios: los generales del grupo, una vez.
    // 30 min antes del cierre (22:26 Colombia) del día del evento detectado.
    const cierreUtc = new Date(`${String(e1.fecha_evento).slice(0, 10)}T22:26:00-05:00`).getTime();
    await ciclo(new Date(cierreUtc - 29 * 60 * 1000));
    await ciclo(new Date(cierreUtc - 28 * 60 * 1000));
    assert.deepStrictEqual([recGeneral("g1@g.us"), recGeneral("g2@g.us")], [1, 1], `recordatorio general una vez por grupo: ${JSON.stringify([recGeneral("g1@g.us"), recGeneral("g2@g.us"), t().eventos_bot.filter(e => e.identidad_evento_real === identidad).map(e => [e.grupo_id, e.hora_cierre, e.fecha_evento, e.activo]), t().event_sessions.map(s => [s.grupo_id, s.estado])])}`);
    assert.strictEqual(t().sorteos_programados.filter(x => x.identidad_evento_real === identidad && x.estado !== "cancelado").length, 1, "una sola programación");
});

prueba("Aislamiento: otra cuenta no puede ver, cambiar ni publicar los grupos del sorteo de A, ni editarlo", async () => {
    escenario();
    const B = "bbbbbbbb-0000-4000-8000-00000000000b";
    t().grupos_autorizados.push({ usuario_id: B, grupo_id: "gb@g.us", activo: true });
    const { s } = await instantaneoEn(["g1@g.us"]);
    const antes = JSON.stringify([t().sorteos_programados_grupos, t().eventos_bot]);
    const c = await silencio(() => gruposSorteo.cambiarGrupos(B, s.id, ["gb@g.us"]));
    const p = await silencio(() => gruposSorteo.publicarGruposNuevos(B, s.id));
    const v = await silencio(() => sorteosActivos.obtener(B, ev("g1@g.us")[0].id));
    const e = await silencio(() => sorteosActivos.editar(B, ev("g1@g.us")[0].id, { grupos: ["gb@g.us"], base: { premios: [], hora_cierre: null } }));
    const vb = await silencio(() => gruposSorteo.vincularSorteoDetectado(B, ev("g1@g.us")[0].id, { cuentas: ["cuenta-a1"] }));
    assert.deepStrictEqual([c.ok, c.motivo, p.ok, p.motivo, v.ok, e.ok, vb.ok], [false, "no_encontrado", false, "no_encontrado", false, false, false]);
    assert.strictEqual(JSON.stringify([t().sorteos_programados_grupos, t().eventos_bot]), antes, "nada cambió");
    assert.strictEqual(total("gb@g.us"), 0);
});

prueba("8. Reinicio del backend: un proceso NUEVO sigue el ciclo sin repetir aperturas ni anuncios, envía el recordatorio una vez, el grupo agregado sigue operativo", async () => {
    escenario();
    const { s } = await instantaneoEn(["g1@g.us", "g2@g.us"]);
    await silencio(() => gruposSorteo.cambiarGrupos(A, s.id, ["g1@g.us", "g2@g.us", "g3@g.us"]));
    await silencio(() => gruposSorteo.publicarGruposNuevos(A, s.id));
    await silencio(drenar);
    fs.writeFileSync(VOLCADO, JSON.stringify({ tablas: t(), enviados }));
    const hijo = spawnSync(process.execPath, [__filename, "--reinicio", VOLCADO], { encoding: "utf8", env: { ...process.env, SUPABASE_URL: "http://127.0.0.1:9" } });
    fs.rmSync(VOLCADO, { force: true });
    assert.strictEqual(hijo.status, 0, `${hijo.stdout.slice(-2000)}\n${hijo.stderr.slice(-2000)}`);
    const inf = JSON.parse(hijo.stdout.trim().split("\n").pop());
    assert.deepStrictEqual(inf.nuevos_anuncios, 0, "sin anuncios repetidos tras reiniciar");
    assert.deepStrictEqual(inf.nuevas_aperturas, 0, "sin aperturas repetidas tras reiniciar");
    assert.deepStrictEqual(inf.recordatorios, [1, 1, 1], "recordatorio del sorteo una vez por grupo");
    assert.strictEqual(inf.reserva_g3, 1, "el grupo agregado sigue aceptando reservas");
});

async function trasReinicio() {
    const v = JSON.parse(fs.readFileSync(VOLCADO, "utf8"));
    fake = crearFake();
    Object.assign(fake.tablas, v.tablas);
    enviados = [];
    await ciclo(LUEGO);
    const anunciosTras = enviados.filter(e => e.tipo === "imagen").length;
    const aperturasTras = enviados.filter(e => e.texto?.startsWith("🔓")).length;
    await ciclo(RECORDATORIO);
    await ciclo(new Date(RECORDATORIO.getTime() + 60 * 1000));
    const rr = await reservar("g3@g.us", "55");
    process.stdout.write(`${JSON.stringify({ nuevos_anuncios: anunciosTras, nuevas_aperturas: aperturasTras, recordatorios: ["g1@g.us", "g2@g.us", "g3@g.us"].map(recSorteo), reserva_g3: rr.filas.length })}\n`);
    process.exit(0);
}

// ------------------------------------------------------------ ejecución ---
(async () => {
    if (HIJO) return trasReinicio();
    let ok = 0;
    for (const p of pruebas) {
        try { await p.fn(); ok++; console.log(`✅ ${p.n}`); }
        catch (e) { console.log(`❌ ${p.n}\n   ${e.stack?.split("\n").slice(0, 4).join("\n   ")}`); }
    }
    console.log("============================");
    console.log(`TOTAL: ${pruebas.length}  ✅ PASA: ${ok}  ❌ FALLA: ${pruebas.length - ok}`);
    console.log("============================");
    process.exit(ok === pruebas.length ? 0 : 1);
})();
