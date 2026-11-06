// ==========================================================================
// F4-G (06/11/2026): RECUPERACIÓN de operaciones interrumpidas sin duplicar
// filas, ciclos, aperturas ni anuncios.
//
// Cada caso reconstruye EXACTAMENTE lo que deja una caída en la base (destino
// «publicando» atascado, fila del evento, registro del anuncio, reclamos C2/
// K3) y comprueba lo que hace la recuperación al «reiniciar» el proceso:
// sorteos/recuperacionPublicacion.js (publicaciones), workerEventos (grupos)
// y motorEventos.recuperarCiclos (ciclos), con las reglas comunes de
// automation/recuperacion.js.
//
// Simulados: Supabase (memoria) y el socket. Sin red ni WhatsApp real.
//
//     node backend/tests/caracterizacion/recuperacionF4G.test.js
// ==========================================================================

"use strict";

const assert = require("assert");
const path = require("path");
const { prueba, ejecutar } = require("./_prueba");
const h = require("./_arnesEventos");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);
const rec = require(r("sorteos/recuperacionPublicacion.js"));
const k3 = require(r("sorteos/publicacionPorGrupo.js"));
const c2 = require(r("bot/funciones/eventos/lifecycle/activacion/reclamoActivacion.js"));
const recuperacion = require(r("automation/recuperacion.js"));
const { workerEventos } = require(r("bot/funciones/eventos/workers/workerEventos.js"));

const G1 = "g1@g.us";
const VIEJO = "2026-10-22T12:00:00.000Z";       // destino atascado (> 10 min)
const RECIENTE = "2026-10-22T13:00:00.000Z";    // reclamo «en curso» de la caída
const t = () => h.estado.fake.tablas;
const activas = () => h.eventosDe(G1).filter(e => e.activo === true);
const destino = (s) => t().sorteos_programados_grupos.find(d => d.sorteo_id === s.id && d.grupo_id === G1);
const reclamos = (tipo) => (t().automation_actions || []).filter(a => a.tipo_accion === tipo);
const opsAbrir = () => h.estado.operaciones.filter(o => o.jid === G1 && o.ajuste === "not_announcement").length;
const drenar = () => h.silencio(h.drenar);
let ids = 0;

function sinDuplicados() {
    assert.strictEqual(activas().length, 1, `una fila activa (hay ${activas().length})`);
    assert.strictEqual(h.sesionesDe(G1).length, 1, "un ciclo");
    assert.strictEqual(h.aperturas(G1).length, 1, "un mensaje de apertura");
    assert.strictEqual(h.anuncios(G1).length, 1, "un anuncio con imagen");
}

// Lo que deja una caída a mitad de la publicación de un programado.
async function atascado(sorteo = null) {
    const s = sorteo || await h.programar(h.entrada({ grupos: [G1] }));
    Object.assign(t().sorteos_programados.find(p => p.id === s.id), { estado: "publicando" });
    Object.assign(destino(s), { estado: "publicando", intentos: 1, actualizado_en: VIEJO });
    return t().sorteos_programados.find(p => p.id === s.id);
}
const accion = (fila) => t().automation_actions.push({ id: `77777777-0000-4000-8000-${String(++ids).padStart(12, "0")}`, usuario_id: h.A, grupo_id: G1, detalle: {}, ...fila });
const reclamoK3 = (s, estado, ejecutado = RECIENTE, dueno = s.id) => accion({ tipo_accion: "PUBLICAR_SORTEO", clave_idempotencia: k3.clavePublicacion({ usuarioId: h.A, grupoId: G1, identidad: s.identidad_evento_real }), estado, ejecutado_en: ejecutado, actualizado_en: ejecutado, detalle: { sorteo_id: dueno } });
const reclamoC2 = (s, estado, ejecutado = RECIENTE) => accion({ tipo_accion: "ACTIVAR_EVENTO", clave_idempotencia: c2.claveActivacion({ usuarioId: h.A, grupoId: G1, identidad: s.identidad_evento_real }), estado, ejecutado_en: ejecutado, actualizado_en: ejecutado, detalle: { entrada: "programado", sorteo_id: s.id } });
const registroAnuncio = (s, estado) => accion({ tipo_accion: "TABLA_COMPARTIR", clave_idempotencia: rec.claveAnuncio(s, destino(s)), estado, ejecutado_en: RECIENTE, actualizado_en: RECIENTE, detalle: estado === "error" ? { mensaje: "not-authorized" } : {} });

// La fila que guardarEvento habría dejado antes de la caída.
async function filaGuardada(s) {
    const c = s.config;
    return h.silencio(() => h.deps().guardarEvento({
        sock: h.sock(), grupoId: G1,
        evento: { nombre: c.nombre, hora: c.hora_fin, horaCierre: c.hora_cierre, valor: c.valor, premios: c.premios || [], tabla: s.tabla, cifras: s.cifras, cantidad_numeros: s.cantidad_numeros },
        eventoAnterior: null, sorteoVigente: { identidad_evento_real: s.identidad_evento_real, fecha_evento: "2026-10-22" }
    }));
}

async function dosProgramaciones() {
    const creadas = [];
    for (let i = 0; i < 2; i++) creadas.push((await h.silencio(() => h.servicio.crearSorteo(h.A, h.entrada({ grupos: [G1] })))).data);
    await Promise.all(creadas.map(c => h.silencio(() => h.servicio.confirmar(h.A, c.id, { version: c.version, confirmacion: true }))));
    return creadas.map(c => t().sorteos_programados.find(p => p.id === c.id));
}

// ------------------------------------------------------------- reglas ---
prueba("0. reglas comunes: estado de un envío por su registro y solo lo NO iniciado se reenvía", () => {
    const { estadoDelEnvio, reenviable, ENVIO } = recuperacion;
    assert.deepStrictEqual([null, { estado: "ok" }, { estado: "en_progreso" }, { estado: "error" }].map(estadoDelEnvio),
        [ENVIO.NO_INICIADO, ENVIO.CONFIRMADO, ENVIO.INCIERTO, ENVIO.FALLIDO]);
    assert.deepStrictEqual(Object.values(ENVIO).filter(reenviable), [ENVIO.NO_INICIADO]);
});

// ---------------------------------------------------------- caídas ---
prueba("1. caída ANTES de crear el evento (reclamos K3 y C2 «en curso» de la caída): se publica UNA vez, sin esperar", async () => {
    h.escenario();
    const s = await atascado();
    reclamoK3(s, "en_progreso");
    reclamoC2(s, "en_progreso");
    await h.tick(h.EN_PUBLICACION);
    sinDuplicados();
    assert.strictEqual(destino(s).estado, "publicado");
    assert.deepStrictEqual([...reclamos("PUBLICAR_SORTEO"), ...reclamos("ACTIVAR_EVENTO")].map(a => a.estado), ["ok", "ok"]);
});

prueba("2. caída DESPUÉS de guardar el evento: reutiliza la fila (no crea otra) y publica una vez", async () => {
    h.escenario();
    const s = await atascado();
    await filaGuardada(s);
    reclamoK3(s, "en_progreso");
    await h.tick(h.EN_PUBLICACION);
    sinDuplicados();
    assert.strictEqual(destino(s).evento_bot_id, activas()[0].id);
});

prueba("3/4/5. caída antes de abrir, después de abrir o antes del anuncio: un anuncio, un mensaje de apertura", async () => {
    for (const abrioAntes of [false, true]) {
        h.escenario();
        const s = await atascado();
        await filaGuardada(s);
        if (abrioAntes) h.estado.operaciones.push({ jid: G1, ajuste: "not_announcement" });
        reclamoK3(s, "en_progreso");
        await h.tick(h.EN_PUBLICACION);
        sinDuplicados();
        // El ajuste «abrir» de WhatsApp es idempotente y se vuelve a aplicar
        // antes del anuncio (no es un mensaje); el mensaje de apertura, una vez.
        assert.strictEqual(opsAbrir(), abrioAntes ? 2 : 1);
    }
});

prueba("6. envío INCIERTO: revisión manual, NO se reenvía nunca solo, y otra programación del mismo sorteo espera", async () => {
    h.escenario();
    const [a, b] = await dosProgramaciones();
    await atascado(a);
    await filaGuardada(a);
    registroAnuncio(a, "en_progreso");
    reclamoK3(a, "en_progreso");
    for (const m of [0, 1, 2, 15]) await h.tick(new Date(h.EN_PUBLICACION.getTime() + m * 60000));
    assert.strictEqual(h.anuncios(G1).length, 0, "nada se reenvía");
    assert.deepStrictEqual([destino(a).estado, destino(a).ultimo_error], ["requiere_revision", rec.INCIERTO]);
    assert.deepStrictEqual(reclamos("PUBLICAR_SORTEO").map(x => [x.estado, x.detalle.sorteo_id]), [["error", a.id]], "el reclamo queda cerrado a nombre de la propietaria");
    assert.strictEqual(destino(b).estado, "pendiente", "la otra programación espera (nunca repite un anuncio incierto)");
});

prueba("7. anuncio CONFIRMADO y caída antes de registrarlo: «publicado» sin reenviar; la otra programación adopta", async () => {
    h.escenario();
    const [a, b] = await dosProgramaciones();
    await atascado(a);
    await filaGuardada(a);
    registroAnuncio(a, "ok");
    reclamoK3(a, "en_progreso");
    await h.tick(h.EN_PUBLICACION);
    await drenar();
    assert.strictEqual(h.anuncios(G1).length, 0, "el anuncio ya había salido: no se repite");
    assert.deepStrictEqual([destino(a).estado, destino(b).estado], ["publicado", "publicado"]);
    assert.strictEqual(destino(b).evento_bot_id, destino(a).evento_bot_id, "publicación compartida");
    assert.deepStrictEqual(reclamos("PUBLICAR_SORTEO").map(x => [x.estado, x.detalle.sorteo_id]), [["ok", a.id]]);
    assert.strictEqual(h.sesionesDe(G1).length, 1, "un ciclo");
    assert.strictEqual(h.aperturas(G1).length, 1, "un mensaje de apertura");
});

prueba("8. recuperación por el WORKER: abre el grupo y reanuda el ciclo UNA vez; una fila cerrada entretanto no se toca", async () => {
    h.escenario();
    h.estado.fallaApertura = (g) => g === G1;
    const ev = await h.detectar(G1); await drenar();
    h.estado.fallaApertura = () => false;
    for (const s of [60, 90, 120]) await h.silencio(() => workerEventos(h.sock(), { ahora: new Date(Date.parse(RECIENTE) + s * 1000) }));
    await drenar();
    assert.strictEqual(h.eventosDe(G1)[0].abierto, true);
    assert.strictEqual(opsAbrir(), 1, "una sola apertura reconciliada");
    assert.strictEqual(h.aperturas(G1).length, 1);
    // Fila cerrada mientras el grupo esperaba turno: no se marca abierta.
    h.escenario();
    h.estado.fallaApertura = (g) => g === G1;
    await h.detectar(G1); await drenar();
    h.estado.fallaApertura = () => false;
    const fila = h.eventosDe(G1)[0];
    const reconciliar = require(r("bot/funciones/eventos/lifecycle/activacion/aperturaGrupo.js"));
    Object.assign(fila, { activo: false, estado: "cerrado" });
    assert.strictEqual(await reconciliar.registrarAperturaConfirmada({ from: (q) => h.estado.fake.client.from(q) }, { ...fila }), false);
    assert.strictEqual(fila.abierto, false);
    void ev;
});

prueba("9. recuperación de CICLOS: confirma un ciclo pendiente con el grupo abierto de verdad, una vez; un OPEN incierto no se repite", async () => {
    h.escenario();
    h.estado.fallaApertura = (g) => g === G1;
    await h.detectar(G1); await drenar();
    h.estado.fallaApertura = () => false;
    Object.assign(h.eventosDe(G1)[0], { abierto: true });
    const sock = { ...h.sock(), groupMetadata: async () => ({ announce: false, participants: [] }) };
    const ahora = new Date(Date.parse(RECIENTE) + 5 * 60000);
    const r1 = await h.silencio(() => h.motor.recuperarCiclos({ sock, ahora, abiertas: [] }));
    const r2 = await h.silencio(() => h.motor.recuperarCiclos({ sock, ahora: new Date(ahora.getTime() + 60000), abiertas: [] }));
    await drenar();
    assert.deepStrictEqual([r1.reanudados, r2.reanudados], [1, 0]);
    assert.deepStrictEqual(h.sesionesDe(G1).map(s => s.estado), ["abierto"]);
    assert.strictEqual(h.aperturas(G1).length, 1);
    // Ciclo abierto cuyo OPEN quedó «en curso» (caída durante el envío): nunca se repite.
    h.escenario();
    await h.detectar(G1); await drenar();
    const ses = h.sesionesDe(G1)[0];
    const open = t().automation_actions.find(a => a.tipo_accion === "OPEN_MESSAGE");
    Object.assign(open, { estado: "en_progreso" });
    const enviadosAntes = h.estado.enviados.length;
    const r3 = await h.silencio(() => h.motor.recuperarCiclos({ sock: h.sock(), ahora: new Date(Date.parse(ses.abierto_en || RECIENTE) + 5 * 60000), abiertas: [ses] }));
    assert.strictEqual(r3.aperturas, 0);
    assert.strictEqual(h.estado.enviados.length, enviadosAntes);
});

prueba("11. DOS procesos recuperando a la vez el mismo destino confirmado: una sola transición, un ciclo, ningún anuncio", async () => {
    h.escenario();
    const s = await atascado();
    await filaGuardada(s);
    registroAnuncio(s, "ok");
    reclamoK3(s, "en_progreso");
    const d = h.deps();
    const [x, y] = await Promise.all([1, 2].map(() => h.silencio(() => rec.recuperarAtascados({ sock: h.sock(), deps: d, ahora: h.EN_PUBLICACION }))));
    await drenar();
    assert.strictEqual(x.informe.length + y.informe.length, 1, "solo uno lo marca (CAS sobre «publicando»)");
    assert.strictEqual(destino(s).estado, "publicado");
    assert.strictEqual(h.anuncios(G1).length, 0);
    assert.strictEqual(h.sesionesDe(G1).length, 1);
    assert.strictEqual(h.aperturas(G1).length, 1);
});

prueba("12. recuperación mientras OTRA programación mantiene el reclamo: espera, no envía", async () => {
    h.escenario();
    const [a, b] = await dosProgramaciones();
    await atascado(b);
    reclamoK3(a, "en_progreso", RECIENTE, a.id);   // A está publicando ahora
    await h.silencio(() => rec.recuperarAtascados({ sock: h.sock(), deps: h.deps(), ahora: h.EN_PUBLICACION }));
    assert.strictEqual(destino(b).estado, "pendiente");
    assert.match(destino(b).ultimo_error, /Otra programación de este mismo sorteo/);
    assert.strictEqual(h.anuncios(G1).length, 0);
    assert.strictEqual(t().eventos_bot.length, 0);
});

prueba("14. reintento de una operación FALLIDA: revisión; «Reintentar» publica una vez (clave nueva)", async () => {
    h.escenario();
    const s = await atascado();
    await filaGuardada(s);
    registroAnuncio(s, "error");
    reclamoK3(s, "en_progreso");
    await h.tick(h.EN_PUBLICACION);
    assert.strictEqual(destino(s).estado, "requiere_revision");
    assert.strictEqual(h.anuncios(G1).length, 0);
    h.servicio.instantaneo._socketDe = () => h.sock();
    h.servicio.instantaneo._deps = h.deps();
    const x = await h.silencio(() => h.servicio.reintentarGrupo(h.A, s.id, G1));
    assert.ok(x.ok, JSON.stringify(x));
    await h.tick(new Date(h.EN_PUBLICACION.getTime() + 60000));
    await drenar();
    sinDuplicados();
    assert.strictEqual(destino(s).estado, "publicado");
});

prueba("15. operaciones ya COMPLETADAS: la recuperación no toca nada", async () => {
    h.escenario();
    const s = await h.programar(h.entrada({ grupos: [G1] }));
    await h.tick(h.EN_PUBLICACION);
    const antes = JSON.stringify({ e: t().eventos_bot, d: t().sorteos_programados_grupos, a: t().automation_actions, env: h.estado.enviados, ops: h.estado.operaciones });
    for (const m of [11, 30]) await h.tick(new Date(h.EN_PUBLICACION.getTime() + m * 60000));
    await h.silencio(() => workerEventos(h.sock(), { ahora: new Date(h.EN_PUBLICACION.getTime() + 31 * 60000) }));
    await drenar();
    const despues = JSON.stringify({ e: t().eventos_bot, d: t().sorteos_programados_grupos, a: t().automation_actions, env: h.estado.enviados, ops: h.estado.operaciones });
    assert.strictEqual(despues, antes);
    assert.strictEqual(destino(s).estado, "publicado");
});

ejecutar("F4-G · recuperación de operaciones interrumpidas").then(() => { h.restaurarTemporizadores(); process.exit(process.exitCode); });
