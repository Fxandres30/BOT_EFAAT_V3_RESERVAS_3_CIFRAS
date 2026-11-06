// ==========================================================================
// CARACTERIZACIÓN C8 (F4-C, 06/11/2026): CONCURRENCIA en la creación y
// publicación de sorteos. Fija el comportamiento ACTUAL, sea el deseado o no,
// antes de refactorizar (F4-D en adelante). Los defectos se marcan con
// riesgo(): la prueba pasa, el riesgo queda escrito, y la etapa que lo
// corrige cambia aquí la expectativa a propósito, con su motivo.
//
// A diferencia de C2 (detectorYPublicador.test.js, que se conserva), aquí el
// Supabase simulado tiene LATENCIA (control.latencia): las inserciones en
// eventos_bot esperan a que la otra operación llegue al mismo punto, como
// pasaría con la latencia de la base real.
//
// F4-F: C2 y K3 corregidos (ver ESPERADO). K4 sin solicitud_id y K5 sin
// cambios a propósito.
//
//   1. C2 con latencia: detector y «Publicar ahora» del mismo sorteo y grupo.
//   2. C2 con latencia: el mismo anuncio procesado dos veces a la vez.
//   3. K3: dos programaciones del MISMO sorteo y grupo confirmadas a la vez.
//   4. K4: doble clic en «Crear sorteo» (POST /sorteos dos veces).
//   5. K5: dos sorteos DISTINTOS del mismo precio activados a la vez.
//   6. Control: dos «Publicar ahora» del mismo sorteo a la vez (protegido).
//
// Simulados: Supabase (memoria, con latencia) y el socket. Sin red.
//
//     node backend/tests/caracterizacion/concurrenciaActivacion.test.js
// ==========================================================================

"use strict";

const assert = require("assert");
const { prueba, riesgo, ejecutar } = require("./_prueba");
const h = require("./_arnesEventos");

const G1 = "g1@g.us", G2 = "g2@g.us";
const t = () => h.estado.fake.tablas;
const activas = (g) => h.eventosDe(g).filter(e => e.activo === true);

// Retiene cada INSERT en eventos_bot hasta que haya `n` pendientes (o pasen
// `maxTicks` vueltas del bucle de eventos): las dos operaciones han leído ya
// «no existe la fila» cuando escriben, como con latencia real.
function barreraInserts(n = 2, maxTicks = 400) {
    const pendientes = [];
    let liberado = false;
    const liberar = () => { liberado = true; pendientes.splice(0).forEach(r => r()); };
    return (tabla, op) => {
        if (liberado || tabla !== "eventos_bot" || op !== "insert") return null;
        return new Promise(res => {
            pendientes.push(res);
            if (pendientes.length >= n) return liberar();
            let i = 0;
            const paso = () => { if (liberado) return; if (++i >= maxTicks) return liberar(); setImmediate(paso); };
            setImmediate(paso);
        });
    };
}

const resumen = (g) => ({
    filas: h.eventosDe(g).length,
    activas: activas(g).length,
    identidades: [...new Set(activas(g).map(e => e.identidad_evento_real))].length,
    ciclos: h.sesionesDe(g).length,
    ciclosConFila: h.sesionesDe(g).filter(s => h.eventosDe(g).some(e => e.id === s.evento_id)).length,
    aperturas: h.aperturas(g).length,
    anuncios: h.anuncios(g).length,
    destinos: (t().sorteos_programados_grupos || []).filter(x => x.grupo_id === g).map(x => x.estado).sort()
});

// ---------------------------------------------------------- 1 ---
prueba("1. C2 con latencia: detector y «Publicar ahora» del mismo sorteo y grupo", async () => {
    h.escenario();
    const s = await h.crearInstantaneo(h.entrada({ publicacion_inmediata: true, publicar_en: undefined, grupos: [G1] }));
    h.estado.fake.control.latencia = barreraInserts(2);
    const [, pub] = await Promise.all([h.detectar(G1), h.publicarAhora(s)]);
    h.estado.fake.control.latencia = null;
    await h.silencio(h.drenar);
    assert.ok(pub.ok, JSON.stringify(pub));
    const r = resumen(G1);
    console.log("   hoy:", JSON.stringify(r));
    assert.deepStrictEqual(r, ESPERADO.c2_detector_y_panel);
});

// ---------------------------------------------------------- 2 ---
prueba("2. C2 con latencia: el mismo anuncio procesado dos veces a la vez en el grupo", async () => {
    h.escenario();
    h.estado.fake.control.latencia = barreraInserts(2);
    await Promise.all([h.detectar(G1), h.detectar(G1)]);
    h.estado.fake.control.latencia = null;
    await h.silencio(h.drenar);
    const r = resumen(G1);
    console.log("   hoy:", JSON.stringify(r));
    assert.deepStrictEqual(r, ESPERADO.c2_doble_anuncio);
});

// ---------------------------------------------------------- 3 ---
prueba("3. K3: dos programaciones del MISMO sorteo y grupo confirmadas a la vez y publicadas", async () => {
    h.escenario();
    const [a, b] = await Promise.all([
        h.silencio(() => h.servicio.crearSorteo(h.A, h.entrada({ grupos: [G1] }))),
        h.silencio(() => h.servicio.crearSorteo(h.A, h.entrada({ grupos: [G1] })))
    ]);
    assert.ok(a.ok && b.ok);
    const conf = await Promise.all([a, b].map(x => h.silencio(() => h.servicio.confirmar(h.A, x.data.id, { version: x.data.version, confirmacion: true }))));
    const confirmadas = conf.filter(x => x.ok).length;
    await h.tick(h.EN_PUBLICACION);
    const r = { confirmadas, programaciones: t().sorteos_programados.map(p => p.estado).sort(), ...resumen(G1) };
    console.log("   hoy:", JSON.stringify(r));
    assert.deepStrictEqual(r, ESPERADO.k3);
});

// ---------------------------------------------------------- 3b ---
prueba("3b. K3 secuencial: la segunda confirmación de la misma programación en el mismo grupo", async () => {
    h.escenario();
    const a = await h.silencio(() => h.servicio.crearSorteo(h.A, h.entrada({ grupos: [G1] })));
    const ca = await h.silencio(() => h.servicio.confirmar(h.A, a.data.id, { version: a.data.version, confirmacion: true }));
    const b = await h.silencio(() => h.servicio.crearSorteo(h.A, h.entrada({ grupos: [G1] })));
    const cb = await h.silencio(() => h.servicio.confirmar(h.A, b.data.id, { version: b.data.version, confirmacion: true }));
    await h.tick(h.EN_PUBLICACION);
    const r = { primera: ca.ok, segunda: cb.ok ? "confirmada" : cb.motivo, ...resumen(G1) };
    console.log("   hoy:", JSON.stringify(r));
    assert.deepStrictEqual(r, ESPERADO.k3_secuencial);
});

// ---------------------------------------------------------- 4 ---
prueba("4. K4: doble clic en «Crear sorteo» con los mismos datos", async () => {
    h.escenario();
    const datos = h.entrada({ grupos: [G1] });
    const [a, b] = await Promise.all([h.silencio(() => h.servicio.crearSorteo(h.A, datos)), h.silencio(() => h.servicio.crearSorteo(h.A, datos))]);
    const r = { respuestas: [a.ok, b.ok], mismoId: a.data?.id === b.data?.id, borradores: t().sorteos_programados.filter(p => p.estado === "borrador").length };
    console.log("   hoy:", JSON.stringify(r));
    assert.deepStrictEqual(r, ESPERADO.k4);
    riesgo("K4 sin solicitud_id (cliente antiguo): un doble clic sigue dejando dos borradores, como siempre. Con solicitud_id (el panel actual) es uno solo: caracterizacion/reclamosF4F.");
});

// ---------------------------------------------------------- 5 ---
prueba("5. K5: dos sorteos DISTINTOS del mismo precio activados a la vez (detector en g2, panel en g1)", async () => {
    h.escenario();
    const s = await h.crearInstantaneo(h.entrada({ publicacion_inmediata: true, publicar_en: undefined, grupos: [G1] }));
    h.estado.fake.control.latencia = barreraInserts(2);
    const otro = "🎰 LOTERÍA DE MANIZALES 10:30 PM\n🍀 Dos últimas cifras → $140.000\n💰 Valor número: $3.000";
    const [, pub] = await Promise.all([
        h.silencio(() => h.detectarEvento({ ...h.contextoDeteccion(G2, otro), message: { key: { id: "m-k5", remoteJid: G2, fromMe: true } } })),
        h.publicarAhora(s)
    ]);
    h.estado.fake.control.latencia = null;
    await h.silencio(h.drenar);
    assert.ok(pub.ok, JSON.stringify(pub));
    const vivas = t().eventos_bot.filter(e => e.activo === true && Number(String(e.valor).replace(/\D/g, "")) === 3000);
    const r = { activasDelPrecio: vivas.length, identidades: [...new Set(vivas.map(e => e.identidad_evento_real))].length, grupos: vivas.map(e => e.grupo_id).sort() };
    console.log("   hoy:", JSON.stringify(r));
    assert.deepStrictEqual(r, ESPERADO.k5);
    if (r.identidades > 1) riesgo("K5 confirmado en memoria: sin la 043 (exclusión en la base, estado sin verificar en producción) dos sorteos distintos del mismo precio quedan activos a la vez. No se corrige en F4: depende de aplicar la 043.");
});

// ---------------------------------------------------------- 6 ---
prueba("6. control: dos «Publicar ahora» del mismo sorteo a la vez → una publicación (CAS de la confirmación)", async () => {
    h.escenario();
    const s = await h.crearInstantaneo(h.entrada({ publicacion_inmediata: true, publicar_en: undefined, grupos: [G1] }));
    h.estado.fake.control.latencia = barreraInserts(2, 100);
    const [a, b] = await Promise.all([h.publicarAhora(s), h.publicarAhora(s)]);
    h.estado.fake.control.latencia = null;
    await h.silencio(h.drenar);
    const r = { ok: [a.ok, b.ok], repetido: [Boolean(a.data?.repetido), Boolean(b.data?.repetido)].sort(), ...resumen(G1) };
    console.log("   hoy:", JSON.stringify(r));
    assert.deepStrictEqual(r, ESPERADO.control_doble_publicar);
});

// Comportamiento de referencia (F4-C, 06/11/2026). Los defectos corregidos en
// F4-F cambian aquí A PROPÓSITO, con el resultado anterior y el motivo.
const ESPERADO = {
    // CORREGIDO F4-F (C2). Antes: 2 filas activas y solo una con ciclo (la otra
    // huérfana). Ahora el reclamo ACTIVAR_EVENTO deja crear UNA; el panel adopta
    // la fila del detector y publica su anuncio sobre ella (como si llegara
    // después): 1 fila, 1 ciclo, 1 apertura, 1 anuncio.
    c2_detector_y_panel: { filas: 1, activas: 1, identidades: 1, ciclos: 1, ciclosConFila: 1, aperturas: 1, anuncios: 1, destinos: ["publicado"] },
    // CORREGIDO F4-F (C2). Antes: 2 filas, 2 ciclos y 2 mensajes de apertura.
    // Ahora el segundo anuncio adopta la fila del primero y no repite nada.
    c2_doble_anuncio: { filas: 1, activas: 1, identidades: 1, ciclos: 1, ciclosConFila: 1, aperturas: 1, anuncios: 0, destinos: [] },
    // CORREGIDO F4-F (K3). Antes: las dos programaciones publicaban (2 anuncios
    // con imagen). Ahora el reclamo PUBLICAR_SORTEO deja publicar a la primera
    // y la segunda ADOPTA la publicación. F4-F.1: la adoptante queda
    // «publicado» (publicación COMPARTIDA, misma fila), no «cancelado» como en
    // la primera versión de F4-F: no se cancela una programación del
    // administrador. Sus recordatorios y aviso los envía la propietaria.
    k3: { confirmadas: 2, programaciones: ["publicado", "publicado"], filas: 1, activas: 1, identidades: 1, ciclos: 1, ciclosConFila: 1, aperturas: 1, anuncios: 1, destinos: ["publicado", "publicado"] },
    // En secuencia, la vista previa bloquea la segunda (programadoSolapado):
    // queda en borrador con su destino pendiente. Correcto hoy.
    k3_secuencial: { primera: true, segunda: "bloqueado", filas: 1, activas: 1, identidades: 1, ciclos: 1, ciclosConFila: 1, aperturas: 1, anuncios: 1, destinos: ["pendiente", "publicado"] },
    // Sin cambio: sin solicitud_id (clientes antiguos) se conserva el
    // comportamiento de siempre. K4 con solicitud_id: reclamosF4F.
    k4: { respuestas: [true, true], mismoId: false, borradores: 2 },
    // Sin cambio (fuera de F4): sorteos DISTINTOS (otra identidad); lo impide la
    // 043 en la base, si está aplicada.
    k5: { activasDelPrecio: 2, identidades: 2, grupos: ["g1@g.us", "g2@g.us"] },
    // Protegido hoy: la segunda petición devuelve el estado («repetido»).
    control_doble_publicar: { ok: [true, true], repetido: [false, true], filas: 1, activas: 1, identidades: 1, ciclos: 1, ciclosConFila: 1, aperturas: 1, anuncios: 1, destinos: ["publicado"] }
};

ejecutar("CARACTERIZACIÓN C8 · concurrencia en la creación y publicación").then(() => { h.restaurarTemporizadores(); process.exit(process.exitCode); });
