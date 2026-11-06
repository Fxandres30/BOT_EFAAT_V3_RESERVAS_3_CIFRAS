// ==========================================================================
// Endurecimiento F3 (06/11/2026): cierre PROTEGIDO del grupo de WhatsApp.
//
// Cuando coinciden un cierre automático (WhatsApp antes de escribir) y uno
// manual (WhatsApp después de escribir), o el reintento del worker, todos
// pasan por el registro central de ejecuciones (executionGuard sobre
// automation_actions, clave única CIERRE_GRUPO:<grupo>:<fila>):
//
//   1. Automático en vuelo + manual: UNA llamada; el manual queda pendiente
//      y el reintento lo resuelve sin volver a llamar.
//   2. Manual primero + automático con lectura vieja: UNA llamada.
//   3. Protección entre procesos: tras «reiniciar» los módulos el registro
//      sigue en la base y no se vuelve a llamar.
//   4. Fallo de WhatsApp: se retoma el registro y se reintenta (las
//      reintentos de siempre siguen); el historial guarda error y éxito.
//   5. Proceso muerto a mitad: un 'en_progreso' vencido se retoma; uno
//      reciente es «en curso».
//   6. Reabrir libera la clave: el siguiente cierre vuelve a cerrar el grupo;
//      el registro anterior se conserva renombrado.
//   7. Sin registro disponible: se cierra igual, como antes.
//   8. Un fallo del automático no marca «fallido» una fila que otro cierre ya
//      terminó.
//   9. executionGuard sin opciones: comportamiento de siempre.
//
// Reales: arnés _arnesEventos, cerrarEvento, executionGuard, gestionEventos,
// workerEventos. Simulados: Supabase (memoria) y el socket. Sin red.
//
//     node backend/tests/caracterizacion/cierreGrupoProtegido.test.js
// ==========================================================================

"use strict";

const assert = require("assert");
const path = require("path");
const { prueba, ejecutar } = require("./_prueba");
const h = require("./_arnesEventos");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);
let orquestador = require(r("bot/funciones/eventos/lifecycle/cerrarEvento.js"));
const guard = require(r("automation/executionGuard.js"));
const gestion = require(r("sorteos/gestionEventos.js"));

const G1 = "g1@g.us", G2 = "g2@g.us";
const ANTES = new Date("2026-10-22T14:00:00Z");
const NOMBRE = "Antioqueñita Día";
const t = () => h.estado.fake.tablas;
const db = { from: (q) => h.estado.fake.client.from(q) };
const fila = (grupo) => t().eventos_bot.find(e => e.grupo_id === grupo && e.nombre_evento === NOMBRE);
const aplicar = (id, entrada, sock = h.sock()) => h.silencio(() => gestion.aplicar(h.A, id, entrada, { ahora: ANTES, socketDe: () => sock }));
const cierres = (desde) => h.estado.operaciones.slice(desde).filter(o => o.ajuste === "announcement").map(o => o.jid);
const registros = () => (t().automation_actions || []).filter(x => x.tipo_accion === "CIERRE_GRUPO");
const historial = () => t().eventos_bot_historial || [];

const COLUMNAS_HORA = () => ({
    activo: false, abierto: false, estado: "cerrado", actualizado_en: ANTES.toISOString(), cierre_estado: "cerrado",
    cierre_motivo: "hora_cierre", cierre_ultimo_error: null, cierre_ultimo_intento_en: ANTES.toISOString(), cerrado_en: ANTES.toISOString()
});

// Socket cuyo cierre de grupo espera a que la prueba lo suelte.
function sockLento() {
    const s = h.sock();
    const original = s.groupSettingUpdate;
    let soltar, avisar;
    const puerta = new Promise(res => { soltar = res; });
    // Se resuelve cuando WhatsApp RECIBE la llamada: el registro ya está
    // «en_progreso» (antes se esperaban 5 vueltas del bucle, sin garantía).
    const llamado = new Promise(res => { avisar = res; });
    s.groupSettingUpdate = async (jid, ajuste) => {
        if (ajuste === "announcement") { avisar(); await puerta; }
        return original(jid, ajuste);
    };
    return { s, soltar, llamado };
}

function sockQueFalla(falla) {
    const s = h.sock();
    const original = s.groupSettingUpdate;
    s.groupSettingUpdate = async (jid, ajuste) => {
        if (ajuste === "announcement" && falla()) throw new Error("not-authorized simulado");
        return original(jid, ajuste);
    };
    return s;
}

const esperarTurno = () => new Promise(res => setImmediate(res));

async function preparar() {
    h.escenario();
    await h.programar(h.entrada({ grupos: [G1, G2] }));
    await h.tick(h.EN_PUBLICACION);
}

// ---------------------------------------------------------- 1 ---
prueba("1. automático en vuelo + «cerrar» del panel: UNA llamada; el panel queda pendiente y el reintento lo resuelve sin llamar", async () => {
    await preparar();
    const leida = { ...fila(G1) };
    const desde = h.estado.operaciones.length;
    const { s, soltar, llamado } = sockLento();

    // CORRECCIÓN DE LA PRUEBA (F4-E, 06/11/2026): el arnés cambia setTimeout
    // por uno de 0 ms, así que el tope de 20 s de la cola de operaciones de
    // grupo vencía al instante y, según el orden del bucle de eventos, la
    // llamada «lenta» acababa en error ANTES de la aserción (fallo
    // intermitente visto en la suite). Aquí la cola usa el temporizador real.
    const temporizadorDelArnes = global.setTimeout;
    global.setTimeout = require("timers").setTimeout;
    try {

    const auto = h.silencio(() => orquestador.terminarFila({ db, sock: s, fila: leida, modalidad: "hora", cambios: COLUMNAS_HORA(), actor: "worker" }));
    await llamado;
    assert.deepStrictEqual(registros().map(x => x.estado), ["en_progreso"], "el automático tiene el registro");

    const panel = await aplicar(leida.id, { accion: "cerrar", alcance: "grupo" }, h.sock());
    assert.ok(panel.ok, JSON.stringify(panel));
    assert.strictEqual(panel.data.whatsapp[0].whatsapp, "en_curso", "el panel no llama: el cierre ya está en curso");
    assert.strictEqual(fila(G1).cierre_motivo, "panel:cerrado manualmente", "el panel gana la escritura");
    assert.strictEqual(fila(G1).abierto, true, "pendiente de confirmar WhatsApp");

    soltar();
    const ra = await auto;
    assert.strictEqual(ra.escrita, false, "el automático pierde la escritura");
    assert.strictEqual(ra.whatsapp, "cerrado");
    assert.deepStrictEqual(cierres(desde), [G1], "una sola llamada");

    const informe = await h.silencio(() => orquestador.reintentarCierresWhatsapp({ db, sock: h.sock(), usuarioId: h.A, ahora: Date.now() }));
    assert.deepStrictEqual(informe.map(x => [x.resultado, x.via]), [["cerrado", "ya_cerrado"]]);
    assert.deepStrictEqual(cierres(desde), [G1], "el reintento no vuelve a llamar");
    assert.strictEqual(fila(G1).abierto, false);
    assert.strictEqual(fila(G1).cierre_ultimo_error, null);
    const reintento = historial().find(x => x.actor === "reintento");
    assert.strictEqual(reintento.resultado, "ok");
    assert.strictEqual(reintento.detalle.via, "ya_cerrado");

    } finally {
        global.setTimeout = temporizadorDelArnes;
    }
});

// ---------------------------------------------------------- 2 ---
prueba("2. «cerrar» del panel primero + automático con lectura vieja: UNA llamada", async () => {
    await preparar();
    const vieja = { ...fila(G1) };
    const desde = h.estado.operaciones.length;
    const panel = await aplicar(vieja.id, { accion: "cerrar", alcance: "grupo" });
    assert.strictEqual(panel.data.whatsapp[0].whatsapp, "cerrado");
    const ra = await h.silencio(() => orquestador.terminarFila({ db, sock: h.sock(), fila: vieja, modalidad: "hora", cambios: COLUMNAS_HORA(), actor: "worker" }));
    assert.strictEqual(ra.escrita, false);
    assert.strictEqual(ra.whatsapp, "cerrado", "el grupo ya estaba cerrado");
    assert.deepStrictEqual(cierres(desde), [G1]);
    assert.strictEqual(historial().find(x => x.modalidad === "hora").detalle.via, "ya_cerrado");
    assert.strictEqual(fila(G1).cierre_motivo, "panel:cerrado manualmente");
});

// ---------------------------------------------------------- 3 ---
prueba("3. entre procesos: tras recargar los módulos (otro proceso) el registro de la base sigue protegiendo", async () => {
    await preparar();
    const vieja = { ...fila(G2) };
    const desde = h.estado.operaciones.length;
    await h.silencio(() => orquestador.terminarFila({ db, sock: h.sock(), fila: vieja, modalidad: "hora", cambios: COLUMNAS_HORA(), actor: "worker" }));
    for (const m of ["bot/funciones/eventos/lifecycle/cerrarEvento.js", "automation/executionGuard.js"]) delete require.cache[r(m)];
    const otroProceso = require(r("bot/funciones/eventos/lifecycle/cerrarEvento.js"));
    assert.notStrictEqual(otroProceso, orquestador, "módulo nuevo, sin memoria compartida");
    const x = await h.silencio(() => otroProceso.cerrarGrupoProtegido({ db, sock: h.sock(), fila: vieja }));
    assert.deepStrictEqual([x.ok, x.via], [true, "ya_cerrado"]);
    assert.deepStrictEqual(cierres(desde), [G2]);
    orquestador = otroProceso;
});

// ---------------------------------------------------------- 4 ---
prueba("4. WhatsApp falla: se retoma el registro y se reintenta; historial con el error y el éxito", async () => {
    await preparar();
    let falla = true;
    const s = sockQueFalla(() => falla);
    const desde = h.estado.operaciones.length;
    const leida = { ...fila(G1) };
    const r1 = await h.silencio(() => orquestador.terminarFila({ db, sock: s, fila: leida, modalidad: "hora", cambios: COLUMNAS_HORA(), actor: "worker" }));
    assert.strictEqual(r1.whatsapp, "fallido");
    assert.strictEqual(fila(G1).activo, true, "sin confirmación no se marca");
    assert.strictEqual(fila(G1).cierre_estado, "fallido");
    assert.deepStrictEqual(registros().map(x => x.estado), ["error"]);

    falla = false;
    const r2 = await h.silencio(() => orquestador.terminarFila({ db, sock: s, fila: { ...fila(G1) }, modalidad: "hora", cambios: COLUMNAS_HORA(), actor: "worker" }));
    assert.strictEqual(r2.escrita, true);
    assert.deepStrictEqual(cierres(desde), [G1]);
    assert.deepStrictEqual(registros().map(x => [x.estado, x.detalle.intentos]), [["ok", 2]], "un solo registro, dos intentos");
    assert.deepStrictEqual(historial().filter(x => x.modalidad === "hora").map(x => [x.resultado, x.detalle.whatsapp]), [["error", "fallido"], ["ok", "cerrado"]]);
});

// ---------------------------------------------------------- 5 ---
prueba("5. proceso muerto a mitad: 'en_progreso' reciente = en curso (no cuenta fallo); vencido (> 5 min) se retoma", async () => {
    await preparar();
    const f = { ...fila(G1) };
    const clave = orquestador.claveCierreGrupo(f);
    const ahora = new Date(Date.now()).toISOString();
    t().automation_actions.push({ id: "colgada", clave_idempotencia: clave, tipo_accion: "CIERRE_GRUPO", grupo_id: G1, usuario_id: h.A, estado: "en_progreso", ejecutado_en: ahora, actualizado_en: ahora, detalle: {} });
    const desde = h.estado.operaciones.length;

    const r1 = await h.silencio(() => orquestador.terminarFila({ db, sock: h.sock(), fila: f, modalidad: "hora", cambios: COLUMNAS_HORA(), actor: "worker" }));
    assert.strictEqual(r1.whatsapp, "en_curso");
    assert.strictEqual(fila(G1).activo, true);
    assert.strictEqual(fila(G1).cierre_intentos || 0, 0, "no cuenta como fallo");
    assert.deepStrictEqual(cierres(desde), []);
    assert.strictEqual(await h.silencio(() => orquestador.cerrarFilaDeEvento({ sock: h.sock(), fila: { ...fila(G1) }, motivo: "hora_cierre" })), false, "el worker lo vuelve a mirar en el siguiente ciclo");

    const vieja = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    Object.assign(t().automation_actions.find(x => x.id === "colgada"), { ejecutado_en: vieja, actualizado_en: vieja });
    const r2 = await h.silencio(() => orquestador.terminarFila({ db, sock: h.sock(), fila: { ...fila(G1) }, modalidad: "hora", cambios: COLUMNAS_HORA(), actor: "worker" }));
    assert.strictEqual(r2.escrita, true);
    assert.deepStrictEqual(cierres(desde), [G1]);
    assert.strictEqual(t().automation_actions.find(x => x.id === "colgada").estado, "ok");
});

// ---------------------------------------------------------- 6 ---
prueba("6. reabrir libera la clave: el siguiente cierre vuelve a cerrar el grupo; el registro anterior se conserva", async () => {
    await preparar();
    const id = fila(G1).id;
    const desde = h.estado.operaciones.length;
    await aplicar(id, { accion: "cerrar", alcance: "grupo" });
    const x = await aplicar(id, { accion: "reabrir", alcance: "grupo", hora_cierre: "22:26" });
    assert.ok(x.ok, JSON.stringify(x));
    assert.strictEqual(historial().find(e => e.modalidad === "reapertura").detalle.clave_cierre_liberada, true);
    await aplicar(id, { accion: "cerrar", alcance: "grupo" });
    assert.deepStrictEqual(cierres(desde), [G1, G1], "dos cierres reales = dos llamadas");
    const claves = registros().map(a => a.clave_idempotencia);
    assert.strictEqual(claves.length, 2);
    assert.ok(claves.some(c => /:retirada:/.test(c)), "el primero queda renombrado, no borrado");
    assert.ok(claves.includes(orquestador.claveCierreGrupo(fila(G1))));
});

// ---------------------------------------------------------- 6b ---
prueba("6b. un 'ok' antiguo (> 10 min) no impide cerrar: se retoma", async () => {
    await preparar();
    const f = { ...fila(G2) };
    const vieja = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    t().automation_actions.push({ id: "antigua", clave_idempotencia: orquestador.claveCierreGrupo(f), tipo_accion: "CIERRE_GRUPO", grupo_id: G2, usuario_id: h.A, estado: "ok", ejecutado_en: vieja, finalizado_en: vieja, actualizado_en: vieja, detalle: {} });
    const desde = h.estado.operaciones.length;
    const x = await h.silencio(() => orquestador.cerrarGrupoProtegido({ db, sock: h.sock(), fila: f }));
    assert.deepStrictEqual([x.ok, x.via], [true, "llamada"]);
    assert.deepStrictEqual(cierres(desde), [G2]);
});

// ---------------------------------------------------------- 7 ---
prueba("7. sin registro disponible (error al insertar): se cierra igual, como antes", async () => {
    await preparar();
    const f = { ...fila(G1) };
    const roto = { from: (tabla) => tabla === "automation_actions" ? { insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { code: "08006", message: "conexión perdida" } }) }) }) } : db.from(tabla) };
    const desde = h.estado.operaciones.length;
    const x = await h.silencio(() => orquestador.cerrarGrupoProtegido({ db: roto, sock: h.sock(), fila: f }));
    assert.deepStrictEqual([x.ok, x.via], [true, "sin_registro"]);
    assert.deepStrictEqual(cierres(desde), [G1]);
});

// ---------------------------------------------------------- 8 ---
prueba("8. un fallo del automático no marca «fallido» una fila que el panel ya cerró", async () => {
    await preparar();
    const vieja = { ...fila(G1) };
    await aplicar(vieja.id, { accion: "cerrar", alcance: "grupo" });
    // Se libera la clave para forzar la llamada del automático y que falle.
    await guard.retirarClave(orquestador.claveCierreGrupo(vieja), { db, motivo: "prueba" });
    const r1 = await h.silencio(() => orquestador.terminarFila({ db, sock: sockQueFalla(() => true), fila: vieja, modalidad: "hora", cambios: COLUMNAS_HORA(), actor: "worker" }));
    assert.strictEqual(r1.whatsapp, "fallido");
    assert.strictEqual(fila(G1).cierre_estado, "cerrado", "no se pisa el cierre manual");
    assert.strictEqual(fila(G1).cierre_motivo, "panel:cerrado manualmente");
});

// ---------------------------------------------------------- 9 ---
prueba("9. executionGuard sin opciones nuevas: un 'error' sigue bloqueando la clave (comportamiento de siempre)", async () => {
    h.escenario();
    let llamadas = 0;
    const base = { claveIdempotencia: "X:1", grupoId: G1, usuarioId: h.A, tipoAccion: "PRUEBA" };
    const a = await h.silencio(() => guard.ejecutarUnaVez({ ...base, ejecutar: async () => { llamadas++; throw new Error("falla"); } }));
    const b = await h.silencio(() => guard.ejecutarUnaVez({ ...base, ejecutar: async () => { llamadas++; } }));
    assert.strictEqual(a.motivo, "fallo_ejecucion");
    assert.strictEqual(b.motivo, "ya_error");
    assert.strictEqual(llamadas, 1);
    assert.deepStrictEqual(Object.keys(t().automation_actions[0].detalle), ["mensaje"], "detalle sin campos nuevos");
});

// ---------------------------------------------------------- 10 ---
prueba("10. historial: transición rechazada y reapertura que pierde la carrera quedan registradas", async () => {
    await preparar();
    const vieja = { ...fila(G1) };
    await aplicar(vieja.id, { accion: "desactivar", alcance: "grupo" });
    const terminada = { ...fila(G1) };
    const r1 = await h.silencio(() => orquestador.terminarFila({ db, fila: terminada, modalidad: "cerrar", cambios: {}, actor: "panel" }));
    assert.strictEqual(r1.transicionInvalida, true);
    assert.deepStrictEqual(historial().filter(x => x.resultado === "rechazado").map(x => [x.modalidad, x.detalle.razon]), [["cerrar", "transicion_invalida"]]);
    // Reapertura con una lectura vieja (otro la reabrió entretanto).
    await aplicar(vieja.id, { accion: "reabrir", alcance: "grupo", hora_cierre: "22:26" });
    const r2 = await h.silencio(() => orquestador.reabrirFila({ db, fila: { ...terminada, estado: "cerrado", cierre_motivo: "otro" }, cambios: { activo: true }, usuarioId: h.A }));
    assert.strictEqual(r2.escrita, false);
    assert.ok(historial().some(x => x.modalidad === "reapertura" && x.resultado === "rechazado"));
});

ejecutar("ENDURECIMIENTO F3 · cierre protegido del grupo de WhatsApp");
