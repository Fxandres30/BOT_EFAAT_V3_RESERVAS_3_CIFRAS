// ==========================================================================
// F4-F.1 (06/11/2026): PUBLICACIÓN COMPARTIDA (K3) y camino de CORRECCIÓN
// sin números (C2).
//
// Dos programaciones del MISMO sorteo apuntan al mismo grupo: la primera
// publica (propietaria) y la segunda ADOPTA. Ninguna se cancela; la relación
// la guarda el reclamo PUBLICAR_SORTEO (sorteos/publicacionCompartida.js).
//
//   1. Recordatorios y aviso de cierre: una sola vez (los de la propietaria).
//   2. Vencimiento: lo aplica la propietaria, nunca la adoptante pura.
//   3. «La programación del sorteo» (los tres resolutores) es la propietaria.
//   4. Quitar el grupo de la adoptante no desactiva el evento compartido.
//   5. Con una sola programación no se lee nada más (comportamiento de siempre).
//   6. C2, corrección sin números: el anuncio que corrige la fila de otro
//      sorteo y el panel que publica el sorteo anunciado, a la vez.
//
// Simulados: Supabase (memoria, con latencia en 6) y el socket. Sin red.
//
//     node backend/tests/caracterizacion/publicacionCompartida.test.js
// ==========================================================================

"use strict";

const assert = require("assert");
const path = require("path");
const { prueba, ejecutar } = require("./_prueba");
const h = require("./_arnesEventos");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);
const compartida = require(r("sorteos/publicacionCompartida.js"));
const gruposSorteo = require(r("sorteos/gruposSorteo.js"));
const prioridad = require(r("automation/prioridadComunicaciones.js"));
const sorteosActivos = require(r("sorteos/sorteosActivos.js"));
const { sendMessage } = require(r("services/baileys/send.js"));

const G1 = "g1@g.us", G2 = "g2@g.us";
const t = () => h.estado.fake.tablas;
const db = { from: (q) => h.estado.fake.client.from(q) };
const activas = (g) => h.eventosDe(g).filter(e => e.activo === true);
const drenar = () => h.silencio(h.drenar);
const CIERRE = new Date("2026-10-23T03:26:00Z");            // 22:26 Colombia
const RECORDATORIO = "⏰ Recordatorio propio del sorteo";
const AVISO = "🔒 Cerrado — aviso propio del sorteo";
const tickPublicador = (ahora) => h.silencio(() => h.publicador.tick(h.sock(), { ahora, deps: h.deps({ sendMessage }) }));
const textos = (prefijo, g) => h.estado.enviados.filter(e => e.tipo === "texto" && e.jid === g && String(e.texto).startsWith(prefijo));

// Dos programaciones del mismo sorteo en G1 confirmadas a la vez y publicadas.
// -> { propietaria, adoptante } (filas de sorteos_programados)
async function compartirPublicacion(extra = [{}, {}]) {
    const creadas = [];
    for (const e of extra) creadas.push((await h.silencio(() => h.servicio.crearSorteo(h.A, h.entrada({ grupos: [G1], ...e })))).data);
    await Promise.all(creadas.map(c => h.silencio(() => h.servicio.confirmar(h.A, c.id, { version: c.version, confirmacion: true }))));
    await h.tick(h.EN_PUBLICACION);
    const dueña = t().automation_actions.find(a => a.tipo_accion === "PUBLICAR_SORTEO").detalle.sorteo_id;
    const fila = (id) => t().sorteos_programados.find(p => p.id === id);
    return { propietaria: fila(dueña), adoptante: fila(creadas.find(c => c.id !== dueña).id) };
}

// ------------------------------------------------------------------ 1 ---
prueba("1. recordatorios y aviso de cierre de una publicación compartida: UNA vez cada uno", async () => {
    h.escenario();
    const conMensajes = { recordatorios: [{ minutos_antes_cierre: 30, texto: RECORDATORIO }], mensajes: { publicacion: "", aviso_cierre: AVISO } };
    const { propietaria, adoptante } = await compartirPublicacion([conMensajes, conMensajes]);
    assert.deepStrictEqual([propietaria.estado, adoptante.estado], ["publicado", "publicado"]);
    for (const m of [29, 28]) await tickPublicador(new Date(CIERRE.getTime() - m * 60000));
    await drenar();
    assert.strictEqual(textos("⏰ Recordatorio propio", G1).length, 1, "un recordatorio");
    for (const e of t().eventos_bot) Object.assign(e, { activo: false, estado: "cerrado", cierre_estado: "cerrado", cierre_motivo: "hora" });
    for (const s of [30, 60]) await tickPublicador(new Date(CIERRE.getTime() + s * 1000));
    await drenar();
    assert.strictEqual(textos("🔒 Cerrado — aviso propio", G1).length, 1, "un aviso de cierre");
});

// ------------------------------------------------------------------ 2 ---
prueba("2. vencimiento de reservas: lo aplica la propietaria; la adoptante pura no (aunque lo tenga activado)", async () => {
    const vencer = { reservas: { liberar_no_pagados: true, vencimiento_minutos: 30 } };
    const conReservaVieja = (sorteo) => Object.assign(t()[h.T5K][5], { estado: "reservado", identidad_evento_real: sorteo.identidad_evento_real, fecha_reserva: "2026-10-22", hora_reserva: "07:00:00", comprador: "Cliente" });
    // Solo la ADOPTANTE lo tiene activado: no se libera.
    h.escenario();
    let par = await compartirPublicacion([{}, {}]);
    Object.assign(par.adoptante.config, vencer);
    conReservaVieja(par.adoptante);
    // Una reserva anterior a la publicación vence contando desde la publicación.
    await tickPublicador(new Date(h.EN_PUBLICACION.getTime() + 45 * 60000));
    assert.strictEqual(t()[h.T5K][5].estado, "reservado", "la adoptante no gobierna el vencimiento");
    // Control: si lo tiene la PROPIETARIA, sí se libera.
    h.escenario();
    par = await compartirPublicacion([{}, {}]);
    Object.assign(par.propietaria.config, vencer);
    conReservaVieja(par.propietaria);
    // Una reserva anterior a la publicación vence contando desde la publicación.
    await tickPublicador(new Date(h.EN_PUBLICACION.getTime() + 45 * 60000));
    assert.strictEqual(t()[h.T5K][5].estado, "libre", "la propietaria sí");
});

// ------------------------------------------------------------------ 3 ---
prueba("3. «la programación del sorteo» es la PROPIETARIA en los tres resolutores (la adoptante es más reciente)", async () => {
    h.escenario();
    const { propietaria, adoptante } = await compartirPublicacion();
    const identidad = propietaria.identidad_evento_real;
    const ev = activas(G1)[0];
    assert.notStrictEqual(propietaria.id, adoptante.id);
    assert.strictEqual((await h.silencio(() => gruposSorteo.programacionDeIdentidad(h.A, identidad))).id, propietaria.id);
    assert.strictEqual((await prioridad.sorteoDelEvento(ev)).sorteo.id, propietaria.id);
    assert.strictEqual((await h.silencio(() => sorteosActivos.obtener(h.A, ev.id))).data.sorteo_programado_id, propietaria.id);
});

// ------------------------------------------------------------------ 4 ---
prueba("4. quitar el grupo de la ADOPTANTE: deja de ser su destino, pero NO desactiva el evento compartido", async () => {
    h.escenario();
    const { propietaria, adoptante } = await compartirPublicacion();
    // La adoptante pasa a otro grupo (G2) y deja G1.
    const c = await h.silencio(() => gruposSorteo.cambiarGrupos(h.A, adoptante.id, [G2], { origen: "panel" }));
    assert.ok(c.ok, JSON.stringify(c));
    assert.deepStrictEqual(c.data.desactivados || [], [], "nada desactivado");
    assert.strictEqual(activas(G1).length, 1, "el sorteo sigue activo en G1 (es de la propietaria)");
    const destinos = t().sorteos_programados_grupos;
    assert.strictEqual(destinos.find(d => d.sorteo_id === adoptante.id && d.grupo_id === G1).estado, "cancelado");
    assert.strictEqual(destinos.find(d => d.sorteo_id === propietaria.id && d.grupo_id === G1).estado, "publicado");
    // Control: quitar el grupo de la PROPIETARIA sí lo desactiva, como siempre.
    const c2 = await h.silencio(() => gruposSorteo.cambiarGrupos(h.A, propietaria.id, [G2], { origen: "panel" }));
    assert.ok(c2.ok);
    assert.strictEqual(activas(G1).length, 0);
});

// ------------------------------------------------------------------ 5 ---
prueba("5. una sola programación: el criterio no lee nada más (resultado de siempre)", async () => {
    h.escenario();
    await h.programar(h.entrada({ grupos: [G1] }));
    const llamadas = h.estado.fake.control.llamadas;
    const antes = llamadas.length;
    const una = [{ id: "p1", identidad_evento_real: "x" }];
    assert.strictEqual(await compartida.elegirProgramacion(db, h.A, una), una[0]);
    assert.strictEqual(await compartida.elegirProgramacion(db, h.A, []), null);
    assert.strictEqual(llamadas.length, antes, "sin lecturas extra");
});

// ------------------------------------------------------------------ 6 ---
function barreraInserts(n, maxTicks = 400) {
    const pendientes = [];
    let liberado = false;
    const liberar = () => { liberado = true; pendientes.splice(0).forEach(x => x()); };
    return (tabla, op) => {
        if (liberado || tabla !== "eventos_bot" || !(op === "insert" || op === "update")) return null;
        return new Promise(res => {
            pendientes.push(res);
            if (pendientes.length >= n) return liberar();
            let i = 0;
            const paso = () => { if (liberado) return; if (++i >= maxTicks) return liberar(); setImmediate(paso); };
            setImmediate(paso);
        });
    };
}

prueba("6. C2 corrección sin números + panel a la vez: UNA fila activa del sorteo anunciado y la anterior sustituida", async () => {
    h.escenario();
    // Sorteo X (Manizales $3.000) detectado en G1, todavía sin números.
    const manizales = ["🎰 LOTERÍA DE MANIZALES 10:30 PM", "🍀 Dos últimas cifras → $140.000", "💰 Valor número: $3.000"].join("\n");
    const x = await h.silencio(() => h.detectarEvento({ ...h.contextoDeteccion(G1, manizales), message: { key: { id: "mx", remoteJid: G1, fromMe: true } } }));
    await drenar();
    assert.ok(x?.id);
    // A la vez: el anuncio de Antioqueñita (corrige la fila de X) y el panel
    // publicando Antioqueñita en G1.
    const s = await h.crearInstantaneo(h.entrada({ publicacion_inmediata: true, publicar_en: undefined, grupos: [G1] }));
    h.estado.fake.control.latencia = barreraInserts(2);
    const [det, pub] = await Promise.all([
        h.silencio(() => h.detectarEvento({ ...h.contextoDeteccion(G1), message: { key: { id: "ma", remoteJid: G1, fromMe: true } } })),
        h.publicarAhora(s)
    ]);
    h.estado.fake.control.latencia = null;
    await drenar();
    assert.ok(pub.ok, JSON.stringify(pub));
    const vivas = activas(G1);
    assert.strictEqual(vivas.length, 1, `una sola fila activa en el grupo (hay ${vivas.length}: ${vivas.map(v => v.nombre_evento).join(", ")})`);
    assert.strictEqual(vivas[0].identidad_evento_real, s.identidad_evento_real, "la del sorteo anunciado");
    assert.strictEqual(det?.id, vivas[0].id, "la detección devuelve esa fila");
    assert.strictEqual(h.anuncios(G1).length, 1, "un anuncio del panel");
    const identidades = new Set(t().eventos_bot.filter(e => e.activo).map(e => e.identidad_evento_real));
    assert.ok(!identidades.has(x.identidad_evento_real) || t().eventos_bot.find(e => e.id === x.id).identidad_evento_real === s.identidad_evento_real, "el sorteo X no queda activo");
});

prueba("6b. corrección sin números SIN concurrencia: corrige la misma fila, como siempre (con su reclamo)", async () => {
    h.escenario();
    const manizales = ["🎰 LOTERÍA DE MANIZALES 10:30 PM", "🍀 Dos últimas cifras → $140.000", "💰 Valor número: $10.000"].join("\n");
    const a = await h.detectar(G1); await drenar();
    const b = await h.silencio(() => h.detectarEvento({ ...h.contextoDeteccion(G1, manizales), message: { key: { id: "mb", remoteJid: G1, fromMe: true } } }));
    await drenar();
    assert.strictEqual(b.id, a.id, "la misma fila, corregida");
    assert.strictEqual(h.eventosDe(G1).length, 1);
    assert.strictEqual(t().automation_actions.filter(x => x.tipo_accion === "ACTIVAR_EVENTO").length, 2, "la creación y la corrección pasaron por su reclamo");
});

ejecutar("F4-F.1 · publicación compartida (K3) y corrección sin números (C2)").then(() => { h.restaurarTemporizadores(); process.exit(process.exitCode); });
