// ==========================================================================
// CARACTERIZACIÓN C6 (F3-A, 06/11/2026): las 12 modalidades de cierre, la
// reapertura y dos casos simultáneos, TAL COMO SE COMPORTAN HOY.
//
// Fija para cada una, sobre el mismo escenario (un sorteo programado de
// $3.000 publicado en g1 y g2, con un número reservado y otro pagado):
//   - qué columnas de eventos_bot cambia y con qué valores;
//   - que la cuadrícula (reservas y pagos) queda intacta;
//   - qué hace en WhatsApp (announcement = cerrar el grupo);
//   - qué avisos salen después (scheduler + publicador, dos ciclos);
//   - en qué estado quedan los ciclos de automatización.
// F3-B/C/D deben conservar todo lo que aquí NO está marcado como riesgo. Lo
// marcado como riesgo (D1, D6, D8) es lo que F3 corrige A PROPÓSITO; esas
// expectativas se actualizarán en el mismo cambio, con su motivo.
//
// Reales: arnés _arnesEventos (detector, publicador, scheduler, motor),
// workerEventos, procesarSorteo, cerrarEvento, gestionEventos,
// unSorteoPorPrecio. Simulados: Supabase (memoria) y el socket.
//
//     node backend/tests/caracterizacion/modalidadesCierre.test.js
// ==========================================================================

"use strict";

const assert = require("assert");
const path = require("path");
const { prueba, riesgo, ejecutar } = require("./_prueba");
const h = require("./_arnesEventos");

const r = (p) => path.resolve(__dirname, "../..", p);
const { workerEventos } = require(r("bot/funciones/eventos/workers/workerEventos.js"));
const gestion = require(r("sorteos/gestionEventos.js"));
const { reemplazarAnteriores } = require(r("shared/eventos/unSorteoPorPrecio.js"));
const { sendMessage } = require(r("services/baileys/send.js"));

const G1 = "g1@g.us", G2 = "g2@g.us";
const ANTES = new Date("2026-10-22T14:00:00Z");     // 09:00 en Colombia: sorteo en curso
const HORA = new Date("2026-10-23T03:27:00Z");      // 22:27: pasó el cierre de las 22:26
const RECUPERADO = new Date("2026-10-24T14:00:00Z"); // dos días después (proceso caído)
const NOMBRE = "Antioqueñita Día", NUEVO = "Lotería de Manizales";
const t = () => h.estado.fake.tablas;
const clon = (x) => JSON.parse(JSON.stringify(x ?? null));
const ISO = /^\d{4}-\d{2}-\d{2}T/;

async function preparar({ pagadoTodo = false } = {}) {
    h.escenario();
    await h.programar(h.entrada({ grupos: [G1, G2] }));
    await h.tick(h.EN_PUBLICACION);
    const id = t().eventos_bot[0].identidad_evento_real;
    if (pagadoTodo) t()[h.T5K].forEach(f => Object.assign(f, { estado: "pagado", identidad_evento_real: id }));
    else {
        Object.assign(t()[h.T5K][7], { estado: "reservado", identidad_evento_real: id, comprador: "Ana", usuario_global_id: "ug-1" });
        Object.assign(t()[h.T5K][8], { estado: "pagado", identidad_evento_real: id, comprador: "Luis", usuario_global_id: "ug-2" });
    }
}

const foto = () => ({ ev: clon(t().eventos_bot), grid: clon(t()[h.T5K]), acc: (t().automation_actions || []).length, ops: h.estado.operaciones.length, env: h.estado.enviados.length, act: (t().reservas_actividad || []).length, aud: (t().reservas_auditoria || []).length });

// Columnas cambiadas por fila (instantes normalizados) + efectos externos.
function efectos(a) {
    const b = foto();
    const filas = {};
    for (const e of b.ev) {
        const previo = a.ev.find(x => x.id === e.id);
        const clave = `${e.grupo_id} ${e.nombre_evento}`;
        if (!previo) { filas[`NUEVA ${clave}`] = { activo: e.activo, estado: e.estado }; continue; }
        const cols = Object.keys(e).filter(k => JSON.stringify(e[k]) !== JSON.stringify(previo[k])).sort();
        if (cols.length) filas[clave] = Object.fromEntries(cols.map(k => [k, typeof e[k] === "string" && ISO.test(e[k]) ? "<instante>" : e[k]]));
    }
    return {
        filas,
        cuadriculaIntacta: JSON.stringify(a.grid) === JSON.stringify(b.grid),
        whatsapp: h.estado.operaciones.slice(a.ops).map(o => `${o.jid}:${o.ajuste}`),
        actividad: b.act - a.act,
        auditoria: b.aud - a.aud
    };
}

// Dos ciclos de scheduler + publicador: qué avisos salen y cómo quedan los ciclos.
async function avisos(desde) {
    const a = foto();
    for (let i = 0; i < 2; i++) {
        const x = new Date(desde.getTime() + 60000 + i * 30000);
        await h.silencio(() => h.scheduler.tick(h.sock(), { ahora: x }));
        await h.silencio(() => h.publicador.tick(h.sock(), { ahora: x, deps: h.deps({ sendMessage }) }));
        await h.silencio(h.drenar);
    }
    const nombreDe = (id) => t().eventos_bot.find(e => e.id === id)?.nombre_evento;
    return {
        acciones: (t().automation_actions || []).slice(a.acc).map(x => `${x.tipo_accion}:${x.estado}`).sort(),
        cierres: h.estado.enviados.slice(a.env).filter(e => e.tipo === "texto" && String(e.texto).startsWith("🔒")).map(e => e.jid).sort(),
        ciclos: t().event_sessions.map(s => `${s.grupo_id}:${nombreDe(s.evento_id)}:${s.estado}`).sort()
    };
}

const fila = (g, nombre = NOMBRE) => t().eventos_bot.find(e => e.grupo_id === g && e.nombre_evento === nombre);
const aplicar = (id, entrada, ahora = ANTES) => h.silencio(() => gestion.aplicar(h.A, id, entrada, { ahora, socketDe: () => h.sock() }));
const worker = (ahora) => h.silencio(() => workerEventos(h.sock(), { ahora }));
const anuncio = (valor) => [`🎰 LOTERÍA DE MANIZALES 10:30 PM`, "🍀 Dos últimas cifras → $140.000", `💰 Valor número: ${valor}`].join("\n");
const detectarComoAdmin = (g, texto) => h.silencio(() => h.detectarEvento({ ...h.contextoDeteccion(g, texto), message: { key: { id: `m-${Math.random()}`, remoteJid: g, fromMe: true } } }));

// Fin común de las dos filas del sorteo (mismo valor en g1 y g2).
const FIN = (extra) => ({ activo: false, cerrado_en: "<instante>", cierre_estado: "cerrado", ...extra });
const CONTADORES = { libres: 98, pagados: 1, pendientes: 1, reservados: 1 };
const AUTOMATICO = (motivo) => FIN({ abierto: false, cierre_motivo: motivo, cierre_ultimo_error: null, cierre_ultimo_intento_en: "<instante>", estado: "cerrado", ...CONTADORES });
const PANEL = (estado, motivo, extra = {}) => FIN({ actualizado_en: "<instante>", cierre_motivo: motivo, cierre_ultimo_error: null, estado, ...extra });
const SUSTITUIDO = (motivo, extra = {}) => FIN({ cierre_motivo: motivo, estado: "cerrado", ...extra });
const AMBOS = (valor) => ({ [`${G1} ${NOMBRE}`]: valor, [`${G2} ${NOMBRE}`]: valor });
const CERRAR_WA = [`${G1}:announcement`, `${G2}:announcement`];
const CICLOS_CERRADOS = [`${G1}:${NOMBRE}:cerrado`, `${G2}:${NOMBRE}:cerrado`];
const AVISO_GRUPO = { acciones: ["CLOSE_MESSAGE:ok", "CLOSE_MESSAGE:ok"], cierres: [G1, G2], ciclos: CICLOS_CERRADOS };
const SIN_AVISO = { acciones: [], cierres: [], ciclos: CICLOS_CERRADOS };

function comprobar(e, av, esperado) {
    assert.deepStrictEqual(e.filas, esperado.filas, "columnas de eventos_bot");
    assert.strictEqual(e.cuadriculaIntacta, true, "reservas y pagos intactos");
    assert.strictEqual(e.actividad, 0, "sin reservas_actividad");
    assert.strictEqual(e.auditoria, 0, "sin reservas_auditoria");
    assert.deepStrictEqual(e.whatsapp, esperado.whatsapp, "WhatsApp");
    assert.deepStrictEqual(av, esperado.avisos, "avisos y ciclos");
}

const MODALIDADES = [
    ["1. hora (worker)", {}, () => worker(HORA), HORA, { filas: AMBOS(AUTOMATICO("hora (sorteo en 2 grupos)")), whatsapp: CERRAR_WA, avisos: AVISO_GRUPO }],
    ["2. todo pagado (worker)", { pagadoTodo: true }, () => worker(ANTES), ANTES,
        { filas: null /* abajo: contadores 0/100 */, whatsapp: CERRAR_WA, avisos: AVISO_GRUPO }],
    ["3. recuperado (cierre atrasado, sin aviso tardío)", {}, () => worker(RECUPERADO), RECUPERADO,
        { filas: AMBOS(AUTOMATICO("hora (sorteo en 2 grupos; recuperado: cierre pendiente del 2026-10-22)")), whatsapp: CERRAR_WA, avisos: SIN_AVISO }],
    ["4. cerrar (panel, todos)", {}, () => aplicar(fila(G1).id, { accion: "cerrar", alcance: "todos" }), ANTES,
        { filas: AMBOS(PANEL("cerrado", "panel:cerrado manualmente", { abierto: false })), whatsapp: CERRAR_WA, avisos: AVISO_GRUPO }],
    ["5. desactivar (panel, todos)", {}, () => aplicar(fila(G1).id, { accion: "desactivar", alcance: "todos" }), ANTES,
        { filas: AMBOS(PANEL("desactivado", "panel:desactivado")), whatsapp: [], avisos: SIN_AVISO }],
    ["6. cancelar (panel)", {}, () => aplicar(fila(G1).id, { accion: "cancelar" }), ANTES,
        { filas: AMBOS(PANEL("cancelado", "panel:cancelado")), whatsapp: [], avisos: SIN_AVISO }],
    ["7. eliminar (panel, lógico)", {}, () => aplicar(fila(G1).id, { accion: "eliminar" }), ANTES,
        { filas: AMBOS(PANEL("eliminado", "panel:eliminado", { archivado_en: "<instante>" })), whatsapp: [], avisos: SIN_AVISO }],
    ["8. sustitución por anuncio (otro precio, mismo grupo)", {}, () => detectarComoAdmin(G1, anuncio("$10.000")), ANTES, {
        filas: { [`${G1} ${NOMBRE}`]: SUSTITUIDO(`sustituido por el anuncio de ${NUEVO} 22:30`), [`NUEVA ${G1} ${NUEVO}`]: { activo: true, estado: "abierto" } },
        whatsapp: [`${G1}:not_announcement`],
        avisos: { acciones: ["INITIAL_TABLE:error", "OPEN_MESSAGE:ok"], cierres: [], ciclos: [`${G1}:${NOMBRE}:cerrado`, `${G1}:${NUEVO}:abierto`, `${G2}:${NOMBRE}:abierto`] }
    }],
    ["9. sustitución por precio (mismo precio, todos los grupos)", {}, () => detectarComoAdmin(G1, anuncio("$3.000")), ANTES, {
        filas: { ...AMBOS(SUSTITUIDO(`sustituido por el anuncio de ${NUEVO} 22:30`)), [`NUEVA ${G1} ${NUEVO}`]: { activo: true, estado: "abierto" } },
        whatsapp: [`${G1}:not_announcement`],
        avisos: { acciones: ["INITIAL_TABLE:error", "OPEN_MESSAGE:ok"], cierres: [], ciclos: [`${G1}:${NOMBRE}:cerrado`, `${G1}:${NUEVO}:abierto`, `${G2}:${NOMBRE}:cerrado`] }
    }],
    ["10. sustitución para reiniciar la tabla (reemplazarAnteriores, motivo del publicador)", {},
        () => h.silencio(() => reemplazarAnteriores({ from: (q) => h.estado.fake.client.from(q) }, { usuarioId: h.A, filas: t().eventos_bot.filter(e => e.activo), motivo: "sustituido por el sorteo Boyacá 22:30", ahora: ANTES })), ANTES,
        { filas: AMBOS(SUSTITUIDO("sustituido por el sorteo Boyacá 22:30", { actualizado_en: "<instante>" })), whatsapp: [], avisos: SIN_AVISO }]
];

// Arreglo de la modalidad 2: sin reservas sueltas, los contadores son 0/100.
MODALIDADES[1][4].filas = AMBOS(Object.fromEntries(Object.entries({ ...AUTOMATICO("pagados (sorteo en 2 grupos)"), libres: 0, pagados: 100 }).filter(([k]) => !["pendientes", "reservados"].includes(k))));

for (const [nombre, opciones, accion, instante, esperado] of MODALIDADES) {
    prueba(nombre, async () => {
        await preparar(opciones);
        const a = foto();
        await accion();
        const e = efectos(a);
        comprobar(e, await avisos(instante), esperado);
    });
}

prueba("11. sustitución al reabrir (reabrir con «sustituir»)", async () => {
    await preparar();
    await aplicar(fila(G1).id, { accion: "cerrar", alcance: "grupo", cerrar_grupo_whatsapp: false });
    await detectarComoAdmin(G1, anuncio("$10.000"));
    const a = foto();
    const x = await aplicar(fila(G1).id, { accion: "reabrir", alcance: "grupo", hora_cierre: "22:26", sustituir: true });
    assert.ok(x.ok, JSON.stringify(x));
    assert.deepStrictEqual(x.data.grupos.map(g => g.estado), ["sustituido", "en_curso"]);
    const e = efectos(a);
    // El motivo nombra al sorteo REABIERTO (el que sustituye).
    assert.deepStrictEqual(e.filas[`${G1} ${NUEVO}`], PANEL("cerrado", `sustituido por ${NOMBRE} 22:30 (reabierto desde el panel)`), "conflicto sustituido");
    // Solo cambia lo que difiere de la fila cerrada (hora_cierre ya era 22:26).
    assert.deepStrictEqual(e.filas[`${G1} ${NOMBRE}`], { abierto: false, activo: true, archivado_en: null, cerrado_en: null, cierre_estado: null, cierre_intentos: 0, cierre_motivo: null, estado: "abierto" }, "reabierta");
    assert.strictEqual(e.cuadriculaIntacta, true);
    assert.deepStrictEqual(e.whatsapp, [], "reabrir no toca WhatsApp: lo reabre el worker");
});

// CAMBIO INTENCIONADO F3-C (06/11/2026): antes «Cerrar» sobre una fila C3
// reescribía su motivo («hora» → «panel:cerrado manualmente»), cerraba
// WhatsApp y enviaba un aviso de cierre tardío. Ahora es la normalización
// (modalidad 12): solo activo=false y el prefijo «normalizado: » delante del
// motivo que tenía; sin WhatsApp y sin aviso; el ciclo se cierra en silencio.
prueba("12. normalización: «Cerrar» sobre una fila C3 la normaliza en silencio (conserva su motivo, sin WhatsApp ni aviso)", async () => {
    await preparar();
    Object.assign(fila(G1), { cierre_estado: "cerrado", cierre_motivo: "hora" });
    const a = foto();
    const x = await aplicar(fila(G1).id, { accion: "cerrar", alcance: "grupo" });
    assert.ok(x.ok, JSON.stringify(x));
    assert.deepStrictEqual(x.data.grupos.map(g => g.estado), ["normalizado"]);
    const e = efectos(a);
    assert.deepStrictEqual(e.filas, { [`${G1} ${NOMBRE}`]: { activo: false, actualizado_en: "<instante>", cierre_motivo: "normalizado: hora" } });
    assert.strictEqual(e.cuadriculaIntacta, true);
    assert.deepStrictEqual(e.whatsapp, []);
    const av = await avisos(ANTES);
    assert.deepStrictEqual(av.acciones, [], "sin aviso tardío");
    assert.deepStrictEqual(av.cierres, []);
    assert.ok(av.ciclos.includes(`${G1}:${NOMBRE}:cerrado`), "su ciclo se cierra en silencio");
});

// ---- simultáneos ----
prueba("simultáneo: cierre por hora (worker) y «cerrar» del panel a la vez", async () => {
    await preparar();
    const a = foto();
    await Promise.all([worker(HORA), aplicar(fila(G1).id, { accion: "cerrar", alcance: "todos" }, HORA)]);
    const e = efectos(a);
    for (const g of [G1, G2]) {
        assert.strictEqual(e.filas[`${g} ${NOMBRE}`].cierre_motivo, "panel:cerrado manualmente", "gana el que escribe primero (aquí el panel)");
        assert.strictEqual(e.filas[`${g} ${NOMBRE}`].activo, false);
    }
    // CAMBIO INTENCIONADO F3-B: antes escribían los DOS (el último pisaba el
    // motivo). Ahora la escritura va condicionada en la base: UN ganador por
    // fila. El perdedor queda como «ya_terminada» si llegó a intentar escribir,
    // o no deja rastro si encontró el cierre del grupo en curso (no hizo nada
    // y vuelve a mirar en su siguiente ciclo).
    const hist = (t().eventos_bot_historial || []).filter(x => ["hora", "cerrar"].includes(x.modalidad));
    for (const g of [G1, G2]) {
        const r = hist.filter(x => x.grupo_id === g).map(x => x.resultado);
        assert.strictEqual(r.filter(x => x === "ok").length, 1, `un solo ganador en ${g}`);
        assert.ok(r.every(x => ["ok", "ya_terminada"].includes(x)), `sin fallos en ${g}: ${r}`);
    }
    // CAMBIO INTENCIONADO (endurecimiento F3, 06/11/2026): antes WhatsApp se
    // llamaba DOS veces por grupo (el automático antes de escribir y el panel
    // después de ganar). Ahora el cierre del grupo pasa por el registro
    // central (automation_actions, clave CIERRE_GRUPO:<grupo>:<fila>): UNA
    // llamada por grupo; el otro ve «ya cerrado» o «en curso».
    assert.deepStrictEqual(e.whatsapp, [`${G1}:announcement`, `${G2}:announcement`]);
    assert.deepStrictEqual((t().automation_actions || []).filter(x => x.tipo_accion === "CIERRE_GRUPO").map(x => x.estado), ["ok", "ok"], "un registro por grupo");
    // El siguiente ciclo del worker no vuelve a tocar WhatsApp.
    const b = foto();
    await worker(new Date(HORA.getTime() + 60000));
    assert.deepStrictEqual(efectos(b).whatsapp, [], "nada pendiente");
    assert.strictEqual(e.cuadriculaIntacta, true);
    assert.deepStrictEqual(await avisos(HORA), AVISO_GRUPO, "el aviso sale una vez por grupo (clave del ciclo)");
});

prueba("simultáneo: «cerrar» y «cancelar» del panel a la vez", async () => {
    await preparar();
    const id = fila(G1).id;
    const a = foto();
    const [rc, rx] = await Promise.all([aplicar(id, { accion: "cerrar", alcance: "todos" }), aplicar(id, { accion: "cancelar" })]);
    assert.ok(rc.ok && rx.ok);
    const e = efectos(a);
    // El resultado comercial es el de siempre: todo el sorteo cancelado. CAMBIO
    // INTENCIONADO F3-C en el CÓMO: antes la cancelación pisaba a ciegas; ahora
    // va condicionada y, si «cerrar» ganó una fila, se relee y se cancela sobre
    // su estado actual.
    for (const g of [G1, G2]) assert.strictEqual(e.filas[`${g} ${NOMBRE}`].estado, "cancelado", "todo el sorteo queda cancelado");
    // WhatsApp solo en el grupo donde «cerrar» llegó a escribir (antes en los
    // dos): cancelar nunca toca WhatsApp.
    assert.deepStrictEqual(e.whatsapp, [`${G1}:announcement`]);
    assert.deepStrictEqual(await avisos(ANTES), SIN_AVISO, "cancelado es silencioso");
});

// ---- reapertura ----
// CAMBIO INTENCIONADO F3-D (06/11/2026): antes, tras reabrir no había ciclo de
// automatización (sin recordatorios) y el siguiente cierre NO se anunciaba
// (D8). Ahora la reapertura central abre un ciclo lógico NUEVO por grupo (el
// anterior se conserva), sin repetir la apertura ni la tabla inicial, y el
// siguiente cierre se anuncia UNA vez con la clave de su ciclo.
prueba("reapertura: cerrar → avisar → reabrir → cierre por hora: ciclo nuevo por grupo y el segundo cierre se anuncia una vez", async () => {
    await preparar();
    const id = fila(G1).id;
    await aplicar(id, { accion: "cerrar", alcance: "todos" });
    assert.deepStrictEqual(await avisos(ANTES), AVISO_GRUPO, "primer cierre anunciado");
    const accionesPrimerCierre = (t().automation_actions || []).filter(x => x.tipo_accion === "CLOSE_MESSAGE").map(x => x.clave_idempotencia).sort();
    const x = await aplicar(id, { accion: "reabrir", alcance: "todos", hora_cierre: "22:26" }, new Date(ANTES.getTime() + 120000));
    assert.ok(x.ok, JSON.stringify(x));
    assert.deepStrictEqual(x.data.grupos.map(g => g.ciclo), ["nuevo", "nuevo"], "un ciclo de reapertura por grupo");
    await worker(new Date(ANTES.getTime() + 180000)); // reabre WhatsApp y confirma el ciclo
    assert.ok(t().eventos_bot.every(e => e.activo === true && e.abierto === true), "reabierto en la base y en WhatsApp");
    const tras = await avisos(new Date(ANTES.getTime() + 180000));
    assert.deepStrictEqual(tras.ciclos, [`${G1}:${NOMBRE}:abierto`, `${G1}:${NOMBRE}:cerrado`, `${G2}:${NOMBRE}:abierto`, `${G2}:${NOMBRE}:cerrado`], "ciclo nuevo abierto; el anterior se conserva cerrado");
    assert.deepStrictEqual(tras.cierres, [], "reabrir no anuncia nada");
    for (const g of [G1, G2]) assert.strictEqual(h.aperturas(g).length, 1, `la apertura de ${g} no se repite (solo la de la publicación)`);
    const a = foto();
    await worker(HORA);
    const e = efectos(a);
    for (const g of [G1, G2]) assert.strictEqual(e.filas[`${g} ${NOMBRE}`].cierre_motivo, "hora (sorteo en 2 grupos)");
    assert.deepStrictEqual(e.whatsapp, CERRAR_WA);
    const segundo = await avisos(HORA);
    assert.deepStrictEqual(segundo.acciones, ["CLOSE_MESSAGE:ok", "CLOSE_MESSAGE:ok"], "el segundo cierre se anuncia una vez por grupo");
    assert.deepStrictEqual(segundo.cierres, [G1, G2]);
    const claves = (t().automation_actions || []).filter(x => x.tipo_accion === "CLOSE_MESSAGE").map(x => x.clave_idempotencia);
    assert.strictEqual(claves.length, 4, "dos cierres x dos grupos, sin duplicados");
    assert.ok(accionesPrimerCierre.every(c => claves.includes(c)), "los avisos del primer cierre no se tocan");
    assert.ok(t().event_sessions.filter(s => String(s.identidad_ciclo).includes(":reapertura:")).length === 2);
});

ejecutar("CARACTERIZACIÓN C6 · modalidades de cierre, reapertura y simultáneos").then(() => { h.restaurarTemporizadores(); process.exit(process.exitCode); });
