// ==========================================================================
// F3-F (06/11/2026): validación del orquestador central del cierre, la
// reapertura y el permiso de reservas. Complementa C6
// (modalidadesCierre.test.js: las 12 modalidades, simultáneos y reapertura).
//
//   1. Idempotencia y protección EN LA BASE (no en memoria).
//   2. WhatsApp «antes»: sin confirmación no se marca; se reintenta.
//   3. WhatsApp «después»: el cierre manual queda hecho; el grupo se reintenta
//      en el worker, también tras un REINICIO del proceso; grupo en uso.
//   4. Aviso PROPIO del sorteo: reabrir y volver a cerrar = un aviso más.
//   5. Permiso de reservas: matriz, canales, auditoría, sin migración.
//   6. Reservas existentes y pagos pendientes intactos.
//   7. Panel = backend con filas normalizadas.
//
// Reales: arnés _arnesEventos, cerrarEvento (orquestador), workerEventos,
// gestionEventos, reservarNumeros, reservaManual, estadosGestion.
// Simulados: Supabase (memoria) y el socket. Sin red ni WhatsApp real.
//
//     node backend/tests/caracterizacion/orquestadorCierre.test.js
// ==========================================================================

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { prueba, ejecutar } = require("./_prueba");
const h = require("./_arnesEventos");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);
const orquestador = require(r("bot/funciones/eventos/lifecycle/cerrarEvento.js"));
const { workerEventos } = require(r("bot/funciones/eventos/workers/workerEventos.js"));
const gestion = require(r("sorteos/gestionEventos.js"));
const g = require(r("shared/eventos/estadosGestion.js"));
const { sorteoAceptaReservas } = require(r("bot/funciones/reservas/detectarReserva.js"));
const { reservarNumerosDetallado } = require(r("bot/funciones/reservas/reservarNumeros.js"));
const reservaManual = require(r("services/reservaManual.js"));
const { sendMessage } = require(r("services/baileys/send.js"));

const G1 = "g1@g.us", G2 = "g2@g.us";
const ANTES = new Date("2026-10-22T14:00:00Z");
const HORA = new Date("2026-10-23T03:27:00Z");
const NOMBRE = "Antioqueñita Día";
const t = () => h.estado.fake.tablas;
const db = { from: (q) => h.estado.fake.client.from(q) };
const fila = (grupo) => t().eventos_bot.find(e => e.grupo_id === grupo && e.nombre_evento === NOMBRE);
const aplicar = (id, entrada, ahora = ANTES, sock = h.sock()) => h.silencio(() => gestion.aplicar(h.A, id, entrada, { ahora, socketDe: () => sock }));
const historial = (modalidad) => (t().eventos_bot_historial || []).filter(x => !modalidad || x.modalidad === modalidad);

// Socket cuyo cierre de grupo («announcement») falla mientras falle() sea true.
function sockQueFalla(falla) {
    const s = h.sock();
    const original = s.groupSettingUpdate;
    s.groupSettingUpdate = async (jid, ajuste) => {
        if (ajuste === "announcement" && falla()) throw new Error("not-authorized simulado");
        return original(jid, ajuste);
    };
    return s;
}

async function preparar(entrada = {}) {
    h.escenario();
    await h.programar(h.entrada({ grupos: [G1, G2], ...entrada }));
    await h.tick(h.EN_PUBLICACION);
    const id = t().eventos_bot[0].identidad_evento_real;
    Object.assign(t()[h.T5K][7], { estado: "reservado", identidad_evento_real: id, comprador: "Ana", usuario_global_id: "ug-1", evento_id: fila(G1).id });
    Object.assign(t()[h.T5K][8], { estado: "pagado", identidad_evento_real: id, comprador: "Luis", usuario_global_id: "ug-2", evento_id: fila(G1).id });
}

async function avisos(desde) {
    for (let i = 0; i < 2; i++) {
        const x = new Date(desde.getTime() + 60000 + i * 30000);
        await h.silencio(() => h.scheduler.tick(h.sock(), { ahora: x }));
        await h.silencio(() => h.publicador.tick(h.sock(), { ahora: x, deps: h.deps({ sendMessage }) }));
        await h.silencio(h.drenar);
    }
}

const operaciones = (desde) => h.estado.operaciones.slice(desde).map(o => `${o.jid}:${o.ajuste}`);

// ---------------------------------------------------------- 1 ---
prueba("1. idempotencia: dos ejecuciones del mismo cierre = una escritura (la segunda queda «ya_terminada»)", async () => {
    await preparar();
    const leida = { ...fila(G1) };
    const cambios = { activo: false, estado: "desactivado", cierre_estado: "cerrado", cierre_motivo: "panel:desactivado", cerrado_en: ANTES.toISOString(), actualizado_en: ANTES.toISOString() };
    const a = await h.silencio(() => orquestador.terminarFila({ db, fila: leida, modalidad: "desactivar", cambios, usuarioId: h.A }));
    const b = await h.silencio(() => orquestador.terminarFila({ db, fila: leida, modalidad: "desactivar", cambios: { ...cambios, cierre_motivo: "panel:desactivado OTRA VEZ" }, usuarioId: h.A }));
    assert.strictEqual(a.escrita, true);
    assert.strictEqual(b.escrita, false, "la segunda no escribe aunque su copia en memoria diga activo=true");
    assert.strictEqual(fila(G1).cierre_motivo, "panel:desactivado", "el motivo no se pisa");
    assert.deepStrictEqual(historial("desactivar").map(x => x.resultado), ["ok", "ya_terminada"]);
});

prueba("1b. protección en la PERSISTENCIA: otro proceso cierra la fila entre la lectura y la escritura → no se reescribe", async () => {
    await preparar();
    const leida = { ...fila(G1) };
    // Otro proceso escribe justo antes del UPDATE del orquestador.
    h.estado.fake.control.antesDeEscribir = (tabla) => {
        if (tabla === "eventos_bot" && fila(G1).activo) Object.assign(fila(G1), { activo: false, estado: "cerrado", cierre_estado: "cerrado", cierre_motivo: "hora" });
        h.estado.fake.control.antesDeEscribir = null;
    };
    const res = await h.silencio(() => orquestador.terminarFila({ db, fila: leida, modalidad: "cerrar", usuarioId: h.A, cerrarGrupo: false, cambios: { activo: false, estado: "cerrado", cierre_estado: "cerrado", cierre_motivo: "panel:cerrado manualmente" } }));
    assert.strictEqual(res.escrita, false);
    assert.strictEqual(fila(G1).cierre_motivo, "hora", "gana el que escribió primero en la base");
});

// ---------------------------------------------------------- 2 ---
prueba("2. WhatsApp «antes» (automático): sin confirmación NO se marca; registra el fallo y el siguiente ciclo lo cierra", async () => {
    await preparar();
    let falla = true;
    const sock = sockQueFalla(() => falla);
    await h.silencio(() => workerEventos(sock, { ahora: HORA }));
    for (const gr of [G1, G2]) {
        assert.strictEqual(fila(gr).activo, true, `${gr} sigue activo`);
        assert.strictEqual(fila(gr).cierre_estado, "fallido");
        assert.strictEqual(fila(gr).cierre_intentos, 1);
    }
    falla = false;
    await h.silencio(() => workerEventos(sock, { ahora: new Date(HORA.getTime() + 30000) }));
    for (const gr of [G1, G2]) assert.strictEqual(fila(gr).activo, false, `${gr} cerrado en el reintento`);
});

// ---------------------------------------------------------- 3 ---
prueba("3. WhatsApp «después» (panel): el cierre queda hecho; el grupo se reintenta en el worker TRAS UN REINICIO", async () => {
    await preparar();
    let falla = true;
    const sock = sockQueFalla(() => falla);
    const x = await aplicar(fila(G1).id, { accion: "cerrar", alcance: "grupo" }, ANTES, sock);
    assert.ok(x.ok, JSON.stringify(x));
    assert.deepStrictEqual(x.data.whatsapp.map(w => w.whatsapp), ["fallido"]);
    assert.strictEqual(fila(G1).activo, false, "cerrado en la base");
    assert.strictEqual(fila(G1).abierto, true, "el grupo sigue abierto en WhatsApp");
    assert.ok(fila(G1).cierre_ultimo_error, "error registrado para reintentar");

    // REINICIO del proceso: se descargan el worker y el orquestador; lo único
    // que queda es la base. El reintento sale de la base, no de la memoria.
    for (const m of ["bot/funciones/eventos/workers/workerEventos.js", "bot/funciones/eventos/lifecycle/cerrarEvento.js"]) delete require.cache[r(m)];
    const workerTrasReinicio = require(r("bot/funciones/eventos/workers/workerEventos.js")).workerEventos;
    falla = false;
    const antes = h.estado.operaciones.length;
    await h.silencio(() => workerTrasReinicio(sock, { ahora: new Date(ANTES.getTime() + 60000) }));
    assert.ok(operaciones(antes).includes(`${G1}:announcement`), "el worker cerró el grupo");
    assert.strictEqual(fila(G1).abierto, false);
    assert.strictEqual(fila(G1).cierre_ultimo_error, null);
    assert.strictEqual(fila(G1).estado, "cerrado", "el cierre comercial no cambió");
});

prueba("3b. reintento de WhatsApp con el grupo YA en uso por otro sorteo vigente: no se cierra y se da por resuelto", async () => {
    await preparar();
    const sock = sockQueFalla(() => true);
    await aplicar(fila(G1).id, { accion: "cerrar", alcance: "grupo" }, ANTES, sock);
    t().eventos_bot.push({ id: "00000000-0000-4000-8000-0000000000aa", usuario_id: h.A, grupo_id: G1, activo: true, estado: "abierto", nombre_evento: "Otro", valor: 5000 });
    const antes = h.estado.operaciones.length;
    await h.silencio(() => workerEventos(h.sock(), { ahora: new Date(ANTES.getTime() + 60000) }));
    assert.ok(!operaciones(antes).includes(`${G1}:announcement`), "no se cierra el grupo del otro sorteo");
    assert.strictEqual(fila(G1).cierre_ultimo_error, null, "pendiente resuelto");
});

// ---------------------------------------------------------- 4 ---
prueba("4. aviso PROPIO del sorteo: cierre → aviso; reabrir → cierre → UN aviso más (clave de su vigencia); nada duplicado", async () => {
    const AVISO = "🔒 Cerrado — aviso propio del sorteo";
    await preparar({ mensajes: { publicacion: "", aviso_cierre: AVISO } });
    // Primer cierre: «cerrar» del panel por la mañana (avisa: no es silencioso).
    await aplicar(fila(G1).id, { accion: "cerrar", alcance: "todos" });
    await avisos(ANTES);
    const primeras = (t().automation_actions || []).filter(x => x.tipo_accion === "SORTEO_AVISO_CIERRE").map(x => x.clave_idempotencia);
    assert.strictEqual(primeras.length, 2, "un aviso por grupo");
    const x = await aplicar(fila(G1).id, { accion: "reabrir", alcance: "todos", hora_cierre: "22:26" }, new Date(ANTES.getTime() + 120000));
    assert.ok(x.ok, JSON.stringify(x));
    await h.silencio(() => workerEventos(h.sock(), { ahora: new Date(ANTES.getTime() + 180000) }));
    await avisos(new Date(ANTES.getTime() + 180000));
    // Segundo cierre: por hora (22:26).
    await h.silencio(() => workerEventos(h.sock(), { ahora: HORA }));
    await avisos(HORA);
    const todas = (t().automation_actions || []).filter(x => x.tipo_accion === "SORTEO_AVISO_CIERRE").map(x => x.clave_idempotencia);
    assert.strictEqual(todas.length, 4, `dos cierres x dos grupos (hay ${todas.length})`);
    assert.strictEqual(new Set(todas).size, 4, "claves distintas");
    assert.ok(primeras.every(c => todas.includes(c)), "las del primer cierre se conservan (formato de siempre)");
    assert.ok(todas.filter(c => !primeras.includes(c)).every(c => /:aviso_cierre:/.test(c)), "las nuevas llevan el ciclo de reapertura");
    assert.strictEqual((t().automation_actions || []).filter(x => x.tipo_accion === "CLOSE_MESSAGE").length, 0, "el aviso general del grupo no se suma");
});

// ---------------------------------------------------------- 5 ---
prueba("5a. matriz del permiso (puedeReservar): abierto/cerrado × según estado/permitidas/desactivadas; cancelado/eliminado/sustituido nunca", () => {
    const abierto = { activo: true, estado: "abierto" };
    const cerrado = { activo: false, estado: "cerrado", cierre_estado: "cerrado", cierre_motivo: "hora" };
    const casos = [
        [abierto, "segun_estado", true], [abierto, "permitidas", true], [abierto, "desactivadas", false],
        [cerrado, "segun_estado", false], [cerrado, "permitidas", true], [cerrado, "desactivadas", false],
        [{ ...abierto, reservas_modo: undefined }, null, true]
    ];
    for (const [e, modo, esperado] of casos) {
        const ev = modo ? { ...e, reservas_modo: modo } : e;
        assert.strictEqual(g.puedeReservar({ evento: ev }).permitido, esperado, JSON.stringify(ev));
    }
    assert.strictEqual(g.puedeReservar({ evento: { ...abierto, reservas_modo: "segun_estado" }, cierrePasado: true }).permitido, false, "hora de cierre pasada");
    assert.strictEqual(g.puedeReservar({ evento: { ...abierto, reservas_modo: "permitidas" }, cierrePasado: true }).permitido, true);
    for (const fin of [{ activo: false, estado: "cancelado" }, { activo: false, estado: "eliminado" }, { activo: false, estado: "cerrado", cierre_motivo: "sustituido por X" }]) {
        assert.strictEqual(g.puedeReservar({ evento: { ...fin, reservas_modo: "permitidas" } }).permitido, false, JSON.stringify(fin));
    }
    assert.strictEqual(g.modoReservas({ reservas_modo: "otro" }), "segun_estado", "valor desconocido = predeterminado");
});

prueba("5b. bot: el mismo permiso (sorteoAceptaReservas)", async () => {
    await preparar();
    await aplicar(fila(G1).id, { accion: "cerrar", alcance: "todos" });
    assert.strictEqual(sorteoAceptaReservas(fila(G1), ANTES), false, "cerrado y según el estado");
    fila(G1).reservas_modo = "permitidas";
    assert.strictEqual(sorteoAceptaReservas(fila(G1), ANTES), true, "cerrado y permitidas");
    fila(G2).reservas_modo = "desactivadas";
    Object.assign(fila(G2), { activo: true, estado: "abierto", cierre_estado: null, cierre_motivo: null });
    assert.strictEqual(sorteoAceptaReservas(fila(G2), ANTES), false, "abierto y desactivadas");
});

prueba("5c. cambiar el permiso: todas las filas del sorteo, auditado con el operador; cerrar y reabrir NO lo cambian", async () => {
    await preparar();
    const p = await h.silencio(() => gestion.cambiarPermisoReservas(h.A, fila(G1).id, { modo: "permitidas", operador: "admin@efaat.test" }));
    assert.ok(p.ok, JSON.stringify(p));
    assert.ok([G1, G2].every(gr => fila(gr).reservas_modo === "permitidas"));
    const reg = historial("permiso_reservas");
    assert.strictEqual(reg.length, 2);
    assert.ok(reg.every(x => x.actor === "admin@efaat.test" && x.detalle.anterior === "segun_estado" && x.detalle.nuevo === "permitidas"));
    await aplicar(fila(G1).id, { accion: "cerrar", alcance: "todos" });
    assert.ok([G1, G2].every(gr => fila(gr).reservas_modo === "permitidas"), "el cierre no lo cambia");
    await aplicar(fila(G1).id, { accion: "reabrir", alcance: "todos", hora_cierre: "22:26" }, new Date(ANTES.getTime() + 60000));
    assert.ok([G1, G2].every(gr => fila(gr).reservas_modo === "permitidas"), "la reapertura no lo cambia");
    assert.strictEqual((await h.silencio(() => gestion.cambiarPermisoReservas(h.A, fila(G1).id, { modo: "a_veces" }))).motivo, "validacion");
});

prueba("5d. sin la migración 047: falla clara y no cambia nada", async () => {
    await preparar();
    const original = h.estado.fake.client.from;
    h.estado.fake.client.from = (q) => {
        const b = original(q);
        if (q !== "eventos_bot") return b;
        const update = b.update.bind(b);
        b.update = (v) => ("reservas_modo" in v ? { eq() { return this; }, then(ok) { return Promise.resolve({ data: null, error: { code: "42703", message: "column \"reservas_modo\" does not exist" } }).then(ok); } } : update(v));
        return b;
    };
    try {
        const p = await h.silencio(() => gestion.cambiarPermisoReservas(h.A, fila(G1).id, { modo: "desactivadas" }));
        assert.strictEqual(p.motivo, "migracion_pendiente");
    } finally { h.estado.fake.client.from = original; }
    assert.ok([G1, G2].every(gr => fila(gr).reservas_modo === undefined));
});

prueba("5e. reserva en un sorteo CERRADO con permiso «permitidas»: se reserva, queda auditada y NO reabre WhatsApp", async () => {
    await preparar();
    await h.silencio(() => workerEventos(h.sock(), { ahora: HORA })); // cierra los dos grupos
    for (const gr of [G1, G2]) fila(gr).reservas_modo = "permitidas";
    const antes = h.estado.operaciones.length;
    const res = await h.silencio(() => reservarNumerosDetallado({ evento: fila(G1), numeros: ["15"], usuario: { id: "ug-9", nombre: "Eva", telefono: "573009998877" }, comprador: "Eva", contacto: "573009998877", origen: "bot" }));
    assert.ok((res.filas || []).some(x => x.numero === "15"), JSON.stringify(res));
    assert.strictEqual(t()[h.T5K].find(x => x.numero === "15").estado, "reservado");
    assert.deepStrictEqual(operaciones(antes), [], "ningún cambio en WhatsApp");
    assert.strictEqual(fila(G1).activo, false, "el sorteo sigue cerrado");
    const aud = (t().reservas_auditoria || []).find(x => x.numero === "15");
    assert.strictEqual(aud?.codigo, "sorteo_cerrado_permitido");
});

// ---------------------------------------------------------- 6 ---
prueba("6. reservas existentes y pagos pendientes: cerrar, reabrir, normalizar y cancelar no tocan la cuadrícula; un pendiente se sigue pagando", async () => {
    await preparar();
    const cuadricula = () => JSON.stringify(t()[h.T5K]);
    const inicial = cuadricula();
    await aplicar(fila(G1).id, { accion: "cerrar", alcance: "todos" });
    assert.strictEqual(cuadricula(), inicial, "cerrar");
    await aplicar(fila(G1).id, { accion: "reabrir", alcance: "todos", hora_cierre: "22:26" }, new Date(ANTES.getTime() + 60000));
    assert.strictEqual(cuadricula(), inicial, "reabrir");
    Object.assign(fila(G2), { cierre_estado: "cerrado", cierre_motivo: "hora" });
    await aplicar(fila(G2).id, { accion: "cerrar", alcance: "grupo" });
    assert.strictEqual(cuadricula(), inicial, "normalizar");
    await aplicar(fila(G1).id, { accion: "cancelar" });
    assert.strictEqual(cuadricula(), inicial, "cancelar");
    // Pago pendiente (el 07 sigue reservado) de un sorteo ya cancelado: el
    // pago manual no depende del estado del sorteo.
    const pago = await h.silencio(() => reservaManual.pagarManual({ usuarioId: h.A, operador: { id: h.A, email: "a@efaat.test" }, precio: 3000, numero: "07", metodoPago: "nequi", solicitudId: "f3f-pago" }));
    assert.ok(pago.ok, JSON.stringify(pago));
    assert.strictEqual(t()[h.T5K][7].estado, "pagado");
});

// ---------------------------------------------------------- 7 ---
prueba("7. panel = backend con filas normalizadas (el motivo original sigue mandando: cancelado sin deuda, silencioso)", () => {
    const ts = require(path.resolve(RAIZ, "../frontend/node_modules/typescript"));
    const fuente = fs.readFileSync(path.resolve(RAIZ, "../frontend/components/eventos/estadoEvento.ts"), "utf8");
    const modulo = { exports: {} };
    new Function("module", "exports", "require", ts.transpileModule(fuente, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(modulo, modulo.exports, require);
    const panel = modulo.exports;
    for (const motivo of ["normalizado: panel:cancelado", "normalizado: panel:desactivado", "normalizado: hora", "normalizado: sustituido por X", "normalizado: panel:eliminado"]) {
        const f = { activo: false, estado: "cerrado", cierre_estado: "cerrado", cierre_motivo: motivo };
        assert.strictEqual(panel.motivoGestion(f), g.motivoGestion(f), motivo);
        if (!g.eliminado(f)) assert.strictEqual(panel.estadoFila(f), g.estadoEnGrupoPorActivo(f), motivo);
        assert.strictEqual(g.cierreSilencioso(f), true, `${motivo}: silencioso`);
    }
    assert.strictEqual(g.sinDeuda({ activo: false, estado: "cerrado", cierre_motivo: "normalizado: panel:cancelado" }), true, "un cancelado normalizado sigue sin deuda");
});

ejecutar("F3-F · orquestador del cierre, reapertura y permiso de reservas").then(() => { h.restaurarTemporizadores(); process.exit(process.exitCode); });
