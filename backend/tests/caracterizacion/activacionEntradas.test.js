// ==========================================================================
// CARACTERIZACIÓN C7 (F4-C, 06/11/2026): HUELLA de cada entrada que crea,
// reutiliza, publica o reanuda un sorteo en un grupo. Fija el comportamiento
// ACTUAL antes de centralizarlo (F4-D en adelante).
//
// Cada escenario deja una «huella» normalizada de todo lo que escribió o
// envió: filas de eventos_bot, ciclos (event_sessions), acciones del
// ExecutionGuard, programación y destinos, historiales, mensajes y
// operaciones de grupo en WhatsApp, estado de la cuadrícula y el resultado
// devuelto. Los ids se sustituyen por etiquetas estables (E:g1#1 = primera
// fila de eventos_bot del grupo g1; S:g1#1 = primer ciclo; P#1 = primera
// programación; I#1 = primera identidad), los instantes por «<t>».
//
// La huella se compara con huellas/c7_activacion.json, generado con el
// código ANTERIOR a F4-D. Un refactor que no cambia el comportamiento debe
// reproducirla exactamente. Si una etapa la cambia A PROPÓSITO, se regenera
// (C7_GENERAR=1) en el mismo cambio y se documenta el motivo.
//
// MEDICIÓN F4-F (06/11/2026): los RECLAMOS de concurrencia (ACTIVAR_EVENTO,
// PUBLICAR_SORTEO, CREAR_SORTEO en automation_actions) son registros nuevos
// de F4-F, no comportamiento de la entrada: se apartan de la huella y se
// comprueban aparte (ninguno queda «en_progreso»). Se verificó que, sin ellos,
// las 25 huellas son IDÉNTICAS a la referencia anterior (la referencia no se
// regeneró). La concurrencia la prueban C8 y caracterizacion/reclamosF4F.
//
//     node backend/tests/caracterizacion/activacionEntradas.test.js
//     C7_GENERAR=1 node backend/tests/caracterizacion/activacionEntradas.test.js
// ==========================================================================

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { prueba, ejecutar } = require("./_prueba");
const h = require("./_arnesEventos");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);
const gestion = require(r("sorteos/gestionEventos.js"));
const gruposSorteo = require(r("sorteos/gruposSorteo.js"));
const { workerEventos } = require(r("bot/funciones/eventos/workers/workerEventos.js"));

const ARCHIVO = path.join(__dirname, "huellas", "c7_activacion.json");
// C7_SALIDA: con C7_GENERAR=1, escribe las huellas en OTRO archivo para
// compararlas sin tocar la referencia.
const SALIDA = process.env.C7_SALIDA || ARCHIVO;
const GENERAR = process.env.C7_GENERAR === "1";
const referencia = GENERAR || !fs.existsSync(ARCHIVO) ? {} : JSON.parse(fs.readFileSync(ARCHIVO, "utf8"));
const generadas = {};

const G1 = "g1@g.us", G2 = "g2@g.us";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const RELOJ = new Date("2026-10-22T13:01:00Z");
const mas = (ms) => new Date(RELOJ.getTime() + ms);
const t = () => h.estado.fake.tablas;
const fila = (g) => h.eventosDe(g)[0];
const anuncio = (loteria, valor) => [`🎰 ${loteria} 10:30 PM`, "🍀 Dos últimas cifras → $140.000", `💰 Valor número: ${valor}`].join("\n");
const comoAdmin = (g, texto) => h.silencio(() => h.detectarEvento({ ...h.contextoDeteccion(g, texto), message: { key: { id: `m-${g}-${texto.length}`, remoteJid: g, fromMe: true } } }));
const comoCliente = (g, texto) => h.silencio(() => h.detectarEvento({ ...h.contextoDeteccion(g, texto), message: { key: { id: `c-${g}-${texto.length}`, remoteJid: g, fromMe: false, participant: "573111111111@s.whatsapp.net" } } }));

function prepararPanel() {
    h.servicio.instantaneo._socketDe = () => h.sock();
    h.servicio.instantaneo._deps = h.deps();
    gruposSorteo.deps.socketDe = () => h.sock();
    gruposSorteo.deps.puedeActuar = () => true;
    gruposSorteo.deps.publicadorDeps = h.deps();
}

// ------------------------------------------------------------ huella ---

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const HASH = /[0-9a-f]{64}/g;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;

function etiquetas() {
    const m = new Map([[h.A, "A"], [B, "B"]]);
    const porGrupo = (filas, prefijo) => {
        const n = {};
        for (const f of filas || []) { n[f.grupo_id] = (n[f.grupo_id] || 0) + 1; m.set(f.id, `${prefijo}:${String(f.grupo_id).replace("@g.us", "")}#${n[f.grupo_id]}`); }
    };
    porGrupo(t().eventos_bot, "E");
    porGrupo(t().event_sessions, "S");
    (t().sorteos_programados || []).forEach((p, i) => m.set(p.id, `P#${i + 1}`));
    const ids = new Map();
    const identidad = (x) => { if (!ids.has(x)) ids.set(x, `I#${ids.size + 1}`); return ids.get(x); };
    for (const f of [...(t().eventos_bot || []), ...(t().sorteos_programados || [])]) if (f.identidad_evento_real) identidad(f.identidad_evento_real);
    return { m, identidad };
}

function normalizar(valor, et) {
    if (valor instanceof Date) return "<t>";
    if (Buffer.isBuffer(valor)) return "<png>";
    if (Array.isArray(valor)) return valor.map(v => normalizar(v, et));
    if (valor && typeof valor === "object") {
        const o = {};
        for (const k of Object.keys(valor).sort()) o[k] = normalizar(valor[k], et);
        return o;
    }
    if (typeof valor === "string") {
        if (ISO.test(valor)) return "<t>";
        return valor.replace(HASH, x => et.identidad(x)).replace(UUID, x => et.m.get(x) || "<id>");
    }
    return valor;
}

const RECLAMOS = new Set(["ACTIVAR_EVENTO", "PUBLICAR_SORTEO", "CREAR_SORTEO"]);

const solo = (o, claves) => Object.fromEntries(claves.filter(k => k in (o || {})).map(k => [k, o[k]]));

function huella(resultado) {
    const et = etiquetas();
    const n = (x) => normalizar(x, et);
    const cuadricula = {};
    for (const f of t()[h.T5K] || []) if (f.estado !== "libre") cuadricula[f.estado] = (cuadricula[f.estado] || 0) + 1;
    return n({
        resultado: resultado ?? null,
        eventos_bot: (t().eventos_bot || []).map(f => ({ ...f })),
        event_sessions: (t().event_sessions || []).map(s => solo(s, ["id", "grupo_id", "evento_id", "estado", "usuario_id", "abierto_en", "cerrado_en"])),
        automation_actions: (t().automation_actions || []).filter(a => !RECLAMOS.has(a.tipo_accion)).map(a => solo(a, ["tipo_accion", "clave_idempotencia", "estado", "grupo_id", "event_session_id"])),
        sorteos_programados: (t().sorteos_programados || []).map(p => ({
            ...solo(p, ["id", "estado", "version", "confirmado_version", "identidad_evento_real", "ultimo_error", "archivado_en", "tabla"]),
            config: solo(p.config || {}, ["publicacion_inmediata", "origen", "grupos", "valor", "nombre", "hora_cierre", "evento_origen_id"])
        })),
        destinos: (t().sorteos_programados_grupos || []).map(g => solo(g, ["sorteo_id", "grupo_id", "estado", "intentos", "reintentos_manuales", "ultimo_error", "evento_bot_id"])),
        historial_programacion: (t().sorteos_programados_historial || []).map(x => solo(x, ["sorteo_id", "accion", "resultado"])),
        historial_eventos: (t().eventos_bot_historial || []).map(x => solo(x, ["evento_id", "grupo_id", "modalidad", "actor", "resultado", "motivo"])),
        enviados: h.estado.enviados.map(e => `${e.jid} ${e.tipo} ${String(e.texto ?? "").slice(0, 40)}`),
        operaciones: h.estado.operaciones.map(o => `${o.jid} ${o.ajuste}`),
        cuadricula
    });
}

// Normaliza lo que devuelve la entrada (fila, respuesta del servicio...).
function devuelto(x) {
    if (x == null) return null;
    if (x.id && x.grupo_id) return { evento: x.id, activo: x.activo };
    if (typeof x === "object" && "ok" in x) return { ok: x.ok, motivo: x.motivo || null, repetido: x.data?.repetido || null, aviso: x.aviso || null, mensaje: x.mensaje || null };
    return x;
}

function escenario(nombre, fn) {
    prueba(nombre, async () => {
        h.escenario();
        prepararPanel();
        const res = await fn();
        await h.silencio(h.drenar);
        const actual = huella(res === undefined ? null : devuelto(res));
        generadas[nombre] = actual;
        const colgados = (t().automation_actions || []).filter(a => RECLAMOS.has(a.tipo_accion) && a.estado === "en_progreso");
        assert.deepStrictEqual(colgados.map(a => a.clave_idempotencia), [], "ningún reclamo queda en curso");
        if (GENERAR) return;
        assert.ok(referencia[nombre], `no hay huella de referencia para «${nombre}»: genera con C7_GENERAR=1`);
        assert.deepStrictEqual(actual, referencia[nombre]);
    });
}

// ================================================ anuncio de WhatsApp ===

escenario("E1 anuncio nuevo en un grupo", () => h.detectar(G1));

escenario("E2 re-anuncio del mismo sorteo en el mismo grupo", async () => {
    await h.detectar(G1);
    await h.silencio(h.drenar);
    return h.detectar(G1);
});

escenario("E3 el mismo sorteo anunciado en otro grupo (continuación)", async () => {
    await h.detectar(G1);
    await h.silencio(h.drenar);
    return h.detectar(G2);
});

escenario("E4 re-anuncio de un sorteo ya cerrado en el grupo: no se reactiva", async () => {
    await h.detectar(G1);
    await h.silencio(h.drenar);
    await h.silencio(() => gestion.aplicar(h.A, fila(G1).id, { accion: "cerrar", alcance: "grupo", cerrar_grupo_whatsapp: false }, { ahora: mas(60000), socketDe: () => h.sock() }));
    return h.detectar(G1);
});

escenario("E5 anuncio de OTRO precio en el mismo grupo (sustitución en el grupo)", async () => {
    await h.detectar(G1);
    await h.silencio(h.drenar);
    return comoAdmin(G1, anuncio("LOTERÍA DE MANIZALES", "$10.000"));
});

escenario("E5b anuncio de OTRO precio en el mismo grupo cuando el anterior YA tiene números (fila nueva + sustitución)", async () => {
    await h.detectar(G1);
    await h.silencio(h.drenar);
    const f = fila(G1);
    Object.assign(t()[h.T5K][7], { estado: "reservado", identidad_evento_real: f.identidad_evento_real, comprador: "Ana", usuario_global_id: "ug-1", evento_id: f.id });
    return comoAdmin(G1, anuncio("LOTERÍA DE MANIZALES", "$10.000"));
});

escenario("E6 anuncio de otro sorteo del MISMO precio en otro grupo, por el administrador (reemplazo por precio)", async () => {
    await h.detectar(G1);
    await h.silencio(h.drenar);
    return comoAdmin(G2, anuncio("LOTERÍA DE MANIZALES", "$3.000"));
});

escenario("E7 lo mismo enviado por un cliente (no administrador): no reemplaza en otros grupos", async () => {
    await h.detectar(G1);
    await h.silencio(h.drenar);
    return comoCliente(G2, anuncio("LOTERÍA DE MANIZALES", "$3.000"));
});

escenario("E8 el mismo anuncio sobre un sorteo programado ya publicado: re-anuncio", async () => {
    await h.programar(h.entrada({ grupos: [G1] }));
    await h.tick(h.EN_PUBLICACION);
    return h.detectar(G1);
});

escenario("E9 aislamiento: sesión validada de otro cliente → no se crea nada", () =>
    h.silencio(() => h.detectarEvento({ ...h.contextoDeteccion(G1), session: { usuarioId: B } })));

// ================================================= panel: publicación ===

escenario("P1 programado: publicación a su hora en dos grupos", async () => {
    await h.programar(h.entrada({ grupos: [G1, G2] }));
    return h.tick(h.EN_PUBLICACION).then(x => ({ ok: x.ok }));
});

escenario("P2 programado: antes de su hora no hace nada", async () => {
    await h.programar(h.entrada({ grupos: [G1] }));
    return h.tick(new Date(h.PUBLICAR.getTime() - 5 * 60000)).then(x => ({ ok: x.ok }));
});

escenario("P3 instantáneo: «Publicar ahora»", async () => {
    const s = await h.crearInstantaneo(h.entrada({ publicacion_inmediata: true, publicar_en: undefined, grupos: [G1, G2] }));
    return h.publicarAhora(s);
});

escenario("P4 programado: fallo de apertura y reintento automático en el siguiente ciclo", async () => {
    await h.programar(h.entrada({ grupos: [G1] }));
    h.estado.fallaApertura = (g) => g === G1;
    await h.tick(h.EN_PUBLICACION);
    h.estado.fallaApertura = () => false;
    return h.tick(mas(60000)).then(x => ({ ok: x.ok }));
});

escenario("P5 instantáneo: fallo de apertura (sin reintento automático) y «Reintentar» manual", async () => {
    const s = await h.crearInstantaneo(h.entrada({ publicacion_inmediata: true, publicar_en: undefined, grupos: [G1] }));
    h.estado.fallaApertura = (g) => g === G1;
    await h.publicarAhora(s);
    await h.silencio(h.drenar);
    h.estado.fallaApertura = () => false;
    return h.silencio(() => h.servicio.reintentarGrupo(h.A, s.id, G1));
});

escenario("P6 programado: «Reintentar» manual de un destino en revisión (clave nueva)", async () => {
    const s = await h.programar(h.entrada({ grupos: [G1] }));
    h.estado.fallaApertura = (g) => g === G1;
    for (let i = 0; i < 6; i++) await h.tick(mas(i * 60000));
    h.estado.fallaApertura = () => false;
    const x = await h.silencio(() => h.servicio.reintentarGrupo(h.A, s.id, G1));
    await h.tick(mas(10 * 60000));
    return x;
});

escenario("P7 grupo nuevo en un sorteo ya publicado (cambiar grupos + publicar)", async () => {
    const s = await h.programar(h.entrada({ grupos: [G1] }));
    await h.tick(h.EN_PUBLICACION);
    const c = await h.silencio(() => gruposSorteo.cambiarGrupos(h.A, s.id, [G1, G2], { origen: "panel" }));
    assert.ok(c.ok, JSON.stringify(c));
    return h.silencio(() => gruposSorteo.publicarGruposNuevos(h.A, s.id));
});

escenario("P8 panel: sorteo de otro sorteo del mismo precio activo en otro grupo (reemplazo por precio)", async () => {
    await comoAdmin(G2, anuncio("LOTERÍA DE MANIZALES", "$3.000"));
    await h.silencio(h.drenar);
    const s = await h.crearInstantaneo(h.entrada({ publicacion_inmediata: true, publicar_en: undefined, grupos: [G1] }));
    return h.publicarAhora(s);
});

// (Si la otra cuenta ya lo tenía al confirmar, la confirmación se bloquea.)
escenario("P9 panel: otra cuenta abre un sorteo en el grupo después de confirmar → en espera", async () => {
    await h.programar(h.entrada({ grupos: [G1] }));
    t().eventos_bot.push({ id: "99999999-0000-4000-8000-000000000999", usuario_id: B, grupo_id: G1, activo: true, estado: "abierto", identidad_evento_real: "b".repeat(64), nombre_evento: "Otro", hora_fin: "21:00", valor: 5000 });
    return h.tick(h.EN_PUBLICACION).then(x => ({ ok: x.ok }));
});

escenario("P10 panel publica un sorteo ya detectado en el grupo (evento existente)", async () => {
    await h.detectar(G1);
    await h.silencio(h.drenar);
    const s = await h.crearInstantaneo(h.entrada({ publicacion_inmediata: true, publicar_en: undefined, grupos: [G1] }));
    return h.publicarAhora(s);
});

escenario("P11 vincular un sorteo detectado y agregarle un grupo", async () => {
    await h.detectar(G1);
    await h.silencio(h.drenar);
    const v = await h.silencio(() => gruposSorteo.vincularSorteoDetectado(h.A, fila(G1).id, { cuentas: ["cuenta-a1"] }));
    assert.ok(v.ok, JSON.stringify(v));
    const c = await h.silencio(() => gruposSorteo.cambiarGrupos(h.A, v.data.sorteo_programado_id, [G1, G2], { origen: "panel" }));
    assert.ok(c.ok, JSON.stringify(c));
    return h.silencio(() => gruposSorteo.publicarGruposNuevos(h.A, v.data.sorteo_programado_id));
});

// ======================================================== recuperación ===

escenario("R1 apertura fallida en la detección; el worker la abre después y reanuda el ciclo", async () => {
    h.estado.fallaApertura = (g) => g === G1;
    await h.detectar(G1);
    await h.silencio(h.drenar);
    h.estado.fallaApertura = () => false;
    await h.silencio(() => workerEventos(h.sock(), { ahora: mas(60000) }));
    return null;
});

escenario("R2 publicación interrumpida ANTES de enviar (sin registro): vuelve a intentarse", async () => {
    const s = await h.programar(h.entrada({ grupos: [G1] }));
    Object.assign(t().sorteos_programados.find(p => p.id === s.id), { estado: "publicando" });
    Object.assign(t().sorteos_programados_grupos.find(g => g.sorteo_id === s.id), { estado: "publicando", intentos: 1, actualizado_en: "2026-10-22T12:00:00.000Z" });
    return h.tick(h.EN_PUBLICACION).then(x => ({ ok: x.ok }));
});

escenario("R3 publicación interrumpida DESPUÉS de enviar (registro ok): publicado sin reenviar", async () => {
    const s = await h.programar(h.entrada({ grupos: [G1] }));
    Object.assign(t().sorteos_programados.find(p => p.id === s.id), { estado: "publicando" });
    Object.assign(t().sorteos_programados_grupos.find(g => g.sorteo_id === s.id), { estado: "publicando", intentos: 1, actualizado_en: "2026-10-22T12:00:00.000Z" });
    t().automation_actions.push({ id: "77777777-0000-4000-8000-000000000777", usuario_id: h.A, grupo_id: G1, tipo_accion: "TABLA_COMPARTIR", estado: "ok", clave_idempotencia: `TABLA_COMPARTIR:${h.A}:3000:sorteo-${s.id}-publicacion-0:${G1}`, ejecutado_en: "2026-10-22T12:59:00.000Z", actualizado_en: "2026-10-22T12:59:30.000Z", detalle: {} });
    return h.tick(h.EN_PUBLICACION).then(x => ({ ok: x.ok }));
});

escenario("R4 publicación interrumpida DURANTE el envío (en_progreso): revisión, sin reenviar", async () => {
    const s = await h.programar(h.entrada({ grupos: [G1] }));
    Object.assign(t().sorteos_programados.find(p => p.id === s.id), { estado: "publicando" });
    Object.assign(t().sorteos_programados_grupos.find(g => g.sorteo_id === s.id), { estado: "publicando", intentos: 1, actualizado_en: "2026-10-22T12:00:00.000Z" });
    t().automation_actions.push({ id: "77777777-0000-4000-8000-000000000778", usuario_id: h.A, grupo_id: G1, tipo_accion: "TABLA_COMPARTIR", estado: "en_progreso", clave_idempotencia: `TABLA_COMPARTIR:${h.A}:3000:sorteo-${s.id}-publicacion-0:${G1}`, ejecutado_en: "2026-10-22T12:59:00.000Z", detalle: {} });
    return h.tick(h.EN_PUBLICACION).then(x => ({ ok: x.ok }));
});

ejecutar("CARACTERIZACIÓN C7 · huella de cada entrada de creación y publicación").then(() => {
    if (GENERAR) {
        fs.mkdirSync(path.dirname(SALIDA), { recursive: true });
        fs.writeFileSync(SALIDA, JSON.stringify(generadas, null, 2) + "\n");
        console.log(`\nHuellas escritas en ${path.relative(RAIZ, SALIDA)} (${Object.keys(generadas).length} escenarios).`);
    }
    h.restaurarTemporizadores();
    process.exit(process.exitCode);
});
