// ==========================================================================
// CARACTERIZACIÓN C5: qué campos deja limpios cada camino que LIBERA un
// número de la cuadrícula.
//
//   manual       services/reservaManual.js liberarManual
//   vencimiento  sorteos/publicador.js     liberarVencidas
//
// Se compara el UPDATE que cada camino envía DE VERDAD a la base, no el
// texto del código.
//
// CAMBIO INTENCIONADO (F1-B, 06/11/2026): en F1-A había dos copias de la
// lista y el vencimiento no limpiaba telefono_bot ni ip_reserva. Ahora los
// dos usan bot/funciones/reservas/liberacion.js: mismo UPDATE (19 campos,
// los de la 030), mismo estado final de la fila y la misma auditoría en
// reservas_auditoria. telefono_bot es el número del negocio (copia de
// eventos_bot.telefono_bot, recuperable por evento_id) e ip_reserva nunca la
// escribió ningún código: limpiarlas no pierde información de auditoría.
//
// Reales: reservaManual.js, publicador.js, sorteos/repo.js, tablasCliente.
// Simulado: Supabase (memoria, fakeSupabaseSorteos). Sin red ni WhatsApp.
//     node backend/tests/caracterizacion/camposLiberacion.test.js
// ==========================================================================

"use strict";

const assert = require("assert");
const path = require("path");
const { prueba, ejecutar } = require("./_prueba");
const { crearFake } = require("../sorteos/fakeSupabaseSorteos");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);

// Supabase simulado que además ANOTA cada .update(payload) por tabla.
let fake = crearFake();
let updates = [];
function cliente() {
    return {
        from(tabla) {
            const b = fake.client.from(tabla);
            const original = b.update;
            b.update = (payload) => { updates.push({ tabla, payload: { ...payload } }); return original.call(b, payload); };
            return b;
        },
        auth: { getUser: (t) => fake.client.auth.getUser(t) },
        rpc: async () => ({ data: null, error: { code: "PGRST202", message: "sin RPC en esta prueba" } })
    };
}
const proxy = { from: (t) => cliente().from(t), auth: { getUser: (t) => fake.client.auth.getUser(t) }, rpc: (...a) => cliente().rpc(...a) };
require.cache[r("lib/supabase.js")] = { id: r("lib/supabase.js"), filename: r("lib/supabase.js"), loaded: true, exports: proxy };

const reservaManual = require(r("services/reservaManual.js"));
const publicador = require(r("sorteos/publicador.js"));

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const T5K = "5k_15k_reservas_2_cifras"; // $3.000 en la configuración base
const IDENTIDAD = "antioquenita-dia|2026-10-22|22:30|3000";
const AHORA = new Date("2026-10-22T20:00:00Z"); // 15:00 en Colombia

// Un número RESERVADO con todos los datos del comprador rellenos.
function filaReservada(numero) {
    return {
        numero, usuario_id: A, estado: "reservado", identidad_evento_real: IDENTIDAD,
        comprador: "Ana", contacto: "573001112233", contacto_lower: "573001112233", nombre: "Ana", telefono: "573001112233",
        lib: "x", grupo_id: "g1@g.us", grupo_nombre: "Grupo 1", evento_id: "ev-1", nombre_evento: "Antioqueñita Día",
        telefono_bot: "573000000000", fecha_reserva: "2026-10-22", hora_reserva: "08:00:00", fecha_pago: null, hora_pago: null,
        temporal_por: null, bloqueado_hasta: null, ip_reserva: "10.0.0.1", usuario_global_id: "ug-1"
    };
}

function escenario() {
    fake = crearFake();
    updates = [];
    const t = fake.tablas;
    t[T5K] = Array.from({ length: 100 }, (_, i) => ({ numero: String(i).padStart(2, "0"), estado: "libre", usuario_id: A }));
    t[T5K][7] = filaReservada("07");
    t.eventos_bot = [{ id: "ev-1", usuario_id: A, grupo_id: "g1@g.us", activo: true, estado: "abierto", identidad_evento_real: IDENTIDAD, tabla: T5K, valor: 3000, nombre_evento: "Antioqueñita Día" }];
    t.sorteos_programados = [{
        id: "sp-1", usuario_id: A, estado: "publicado", identidad_evento_real: IDENTIDAD, tabla: T5K,
        publicar_en: "2026-10-22T13:00:00Z",
        config: { valor: 3000, reservas: { liberar_no_pagados: true, vencimiento_minutos: 30 } }
    }];
    t.sorteos_programados_grupos = [{ id: "spg-1", usuario_id: A, sorteo_id: "sp-1", grupo_id: "g1@g.us", estado: "publicado", publicado_en: "2026-10-22T13:00:00Z", creado_en: "2026-10-22T12:00:00Z" }];
    t.reservas_actividad = [];
    t.reservas_auditoria = [];
}

async function silencio(fn) {
    const { log, warn, error } = console;
    console.log = console.warn = console.error = () => {};
    try { return await fn(); } finally { Object.assign(console, { log, warn, error }); }
}

const liberacionDe = () => updates.filter(u => u.tabla === T5K && u.payload.estado === "libre").map(u => u.payload);

async function payloadManual() {
    escenario();
    const res = await silencio(() => reservaManual.liberarManual({ usuarioId: A, operador: { id: A, email: "a@efaat.test" }, precio: 3000, numero: "07", confirmar: true, solicitudId: "c5-manual" }));
    assert.ok(res && res.ok !== false, `liberarManual respondió: ${JSON.stringify(res)}`);
    const p = liberacionDe();
    assert.strictEqual(p.length, 1, "un solo UPDATE de liberación (manual)");
    return { payload: p[0], fila: fake.tablas[T5K][7] };
}

async function payloadVencimiento() {
    escenario();
    const res = await silencio(() => publicador.liberarVencidas({ sock: { context: { usuarioId: A } }, deps: { supabase: proxy, actualizarEvento: async () => {} }, ahora: AHORA }));
    assert.ok(res.ok, "liberarVencidas terminó");
    assert.deepStrictEqual(res.liberados.map(l => l.numero), ["07"], "liberó el 07 vencido");
    const p = liberacionDe();
    assert.strictEqual(p.length, 1, "un solo UPDATE de liberación (vencimiento)");
    return { payload: p[0], fila: fake.tablas[T5K][7] };
}

prueba("manual: deja libre el número y limpia los 19 campos del comprador", async () => {
    const { payload, fila } = await payloadManual();
    assert.strictEqual(fila.estado, "libre");
    assert.deepStrictEqual(Object.keys(payload).sort(), [
        "bloqueado_hasta", "comprador", "contacto", "contacto_lower", "estado", "evento_id", "fecha_pago", "fecha_reserva",
        "grupo_id", "grupo_nombre", "hora_pago", "hora_reserva", "ip_reserva", "lib", "nombre", "nombre_evento",
        "telefono", "telefono_bot", "temporal_por", "usuario_global_id"
    ]);
});

prueba("vencimiento: deja libre el número y limpia los MISMOS 19 campos", async () => {
    const { payload, fila } = await payloadVencimiento();
    assert.strictEqual(fila.estado, "libre");
    assert.strictEqual(Object.keys(payload).length, 20, "estado + 19 campos");
    assert.strictEqual(fila.telefono_bot, null);
    assert.strictEqual(fila.ip_reserva, null);
});

prueba("manual y vencimiento envían el MISMO UPDATE y dejan la fila IGUAL", async () => {
    const manual = await payloadManual();
    const venc = await payloadVencimiento();
    assert.deepStrictEqual(venc.payload, manual.payload, "mismo UPDATE");
    assert.deepStrictEqual(venc.fila, manual.fila, "mismo estado final de la fila");
});

prueba("los dos dejan en reservas_auditoria quién tenía el número antes de limpiarlo", async () => {
    const ok = (filas) => filas.filter(a => a.accion === "liberar" && a.resultado === "ok");
    await payloadManual();
    const manual = ok(fake.tablas.reservas_auditoria);
    await payloadVencimiento();
    const venc = ok(fake.tablas.reservas_auditoria);
    assert.strictEqual(manual.length, 1, "auditoría manual");
    assert.strictEqual(venc.length, 1, "auditoría del vencimiento");
    const comunes = ["usuario_id", "tabla", "numero", "evento_id", "identidad_evento_real", "grupo_id", "grupo_nombre",
        "contacto_id", "contacto_nombre", "contacto_telefono", "estado_anterior", "estado_nuevo", "resultado"];
    for (const k of comunes) assert.deepStrictEqual(venc[0][k], manual[0][k], `mismo ${k}`);
    assert.strictEqual(venc[0].contacto_nombre, "Ana");
    assert.strictEqual(venc[0].evento_id, "ev-1", "evento_id: de ahí se recupera telefono_bot");
    assert.strictEqual(manual[0].origen, "manual");
    assert.strictEqual(venc[0].origen, "bot");
    assert.ok(/vencimiento/.test(venc[0].motivo));
});

ejecutar("CARACTERIZACIÓN C5 · campos que limpia cada liberación");
