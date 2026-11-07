// ==========================================================================
// FASE O5 — REACCIONES ✅/❌ a las reservas en MODO SOMBRA.
//
// Reales: reaccionReserva.reaccionarAlMensaje (con su llamada en sombra),
// sombraReacciones.js y shared/mensajes. Simulados: Supabase (memoria,
// consultas contadas) y el envío de la reacción (espía).
//
//     node backend/tests/mensajes-o5/o5ReaccionesSombra.test.js
// ==========================================================================

"use strict";

process.env.REACCIONES_CACHE_MS = "0";
delete process.env.MENSAJES_ORQUESTADOR_REACCION;

const assert = require("assert");
const { r, inyectar, crearDb } = require("../mensajes-o0/_comun");
const { prueba, ejecutar } = require("../caracterizacion/_prueba");

let db = crearDb();
inyectar(r("lib/supabase.js"), { from: (t) => db.client.from(t) });

const reaccion = require(r("bot/funciones/reservas/reaccionReserva.js"));

const A = "tenant-A";
const B = "tenant-B";
let sec = 0;

function escenario({ modo = "shadow", interruptor = null } = {}) {
    if (modo) process.env.MENSAJES_ORQUESTADOR_REACCION = modo; else delete process.env.MENSAJES_ORQUESTADOR_REACCION;
    db = crearDb({ configuracion_seleccion_mensajes: interruptor === null ? [] : [{ usuario_id: A, tipo_respuesta: "reacciones_reserva", habilitada: interruptor }] });
    reaccion._reiniciar();
}

function ctx(extra = {}) {
    return {
        sock: { context: { usuarioId: A } }, session: { usuarioId: A },
        chat: { remoteJid: "573001112233-1111@g.us", esGrupo: true },
        message: { key: { id: `K${++sec}`, remoteJid: "573001112233-1111@g.us", fromMe: false } },
        ...extra
    };
}

async function reaccionar(c, emoji, enviar) {
    const enviadas = [];
    const capturadas = [];
    const { log, warn, error } = console;
    console.log = console.warn = console.error = (...a) => capturadas.push(a.map(x => (typeof x === "string" ? x : "")).join(" "));
    let ok;
    try { ok = await reaccion.reaccionarAlMensaje({ ctx: c, emoji, enviar: enviar || (async (x) => { enviadas.push(x); }) }); }
    finally { Object.assign(console, { log, warn, error }); }
    const crudas = capturadas.filter(l => l.startsWith("[MENSAJES SOMBRA]"));
    return { ok, enviadas, sombras: crudas.map(l => JSON.parse(l.slice(18))), crudas, todo: capturadas };
}

const unica = (s) => { assert.strictEqual(s.length, 1, JSON.stringify(s)); return s[0]; };
const lecturasInterruptor = () => db.consultas.filter(c => c.tabla === "configuracion_seleccion_mensajes").length;

prueba("O5R-1 sin la variable (off): reacciona igual, ninguna línea y una sola lectura (la del motor)", async () => {
    escenario({ modo: null });
    const { ok, enviadas, sombras } = await reaccionar(ctx(), "✅");
    assert.deepStrictEqual([ok, enviadas.length, sombras.length, lecturasInterruptor()], [true, 1, 0, 1]);
});

prueba("O5R-2 ✅ y ❌ enviadas: la sombra habría reaccionado igual (mismo emoji, canal reacción) y no reacciona", async () => {
    escenario();
    for (const emoji of ["✅", "❌"]) {
        const { ok, enviadas, sombras } = await reaccionar(ctx(), emoji);
        assert.deepStrictEqual([ok, enviadas.length], [true, 1]);
        const s = unica(sombras);
        assert.deepStrictEqual([s.coincide, s.emoji, s.orquestador.reacciona, s.orquestador.canal, s.actual.motivo], [true, emoji, true, "reaccion", "enviada"]);
    }
});

prueba("O5R-3 interruptor apagado: ni el motor ni la sombra reaccionan (coincide)", async () => {
    escenario({ interruptor: false });
    const { ok, enviadas, sombras } = await reaccionar(ctx(), "✅");
    assert.deepStrictEqual([ok, enviadas.length], [false, 0]);
    const s = unica(sombras);
    assert.deepStrictEqual([s.coincide, s.actual.motivo, s.orquestador.motivo], [true, "interruptor_apagado", "interruptor_apagado"]);
});

prueba("O5R-4 fallo al enviar la reacción: el motor devuelve false; la sombra coincide en que habría reaccionado", async () => {
    escenario();
    const { ok, sombras } = await reaccionar(ctx(), "❌", async () => { throw new Error("WhatsApp (simulado)"); });
    assert.strictEqual(ok, false);
    assert.deepStrictEqual([unica(sombras).coincide, sombras[0].actual.motivo], [true, "fallo_envio"]);
});

prueba("O5R-5 sin decisión del motor (sin emoji, no es grupo, mensaje propio, ya reaccionado) → sin comparación ni lecturas de la sombra", async () => {
    escenario();
    const c = ctx();
    await reaccionar(c, "✅");
    const lecturas = lecturasInterruptor();
    const casos = [
        await reaccionar(ctx(), null),
        await reaccionar(ctx({ chat: { remoteJid: "u@s.whatsapp.net", esGrupo: false } }), "✅"),
        await reaccionar((() => { const x = ctx(); x.message.key.fromMe = true; return x; })(), "✅"),
        await reaccionar(c, "✅")
    ];
    assert.ok(casos.every(x => x.ok === false && x.sombras.length === 0 && x.enviadas.length === 0));
    assert.strictEqual(lecturasInterruptor(), lecturas);
});

prueba("O5R-6 la sombra NO marca el mensaje como reaccionado (la caché intacta la demuestra O5R-7)", async () => {
    escenario({ modo: "shadow", interruptor: false });
    const c = ctx();
    await reaccionar(c, "✅");                       // motor: apagado (no marca); sombra compara
    db.tablas.configuracion_seleccion_mensajes[0].habilitada = true;
    const { ok, enviadas } = await reaccionar(c, "✅"); // si la sombra lo hubiera marcado, aquí no reaccionaría
    assert.deepStrictEqual([ok, enviadas.length], [true, 1]);
});

prueba("O5R-7 caché del motor frente a lectura directa de la sombra → «interruptor_distinto» (diferencia esperada)", async () => {
    process.env.REACCIONES_CACHE_MS = "60000";
    try {
        escenario({ interruptor: true });
        await reaccionar(ctx(), "✅");                               // el motor guarda «activado» en su caché
        db.tablas.configuracion_seleccion_mensajes[0].habilitada = false; // el admin lo apaga
        const { ok, sombras } = await reaccionar(ctx(), "✅");      // el motor aún usa la caché
        assert.strictEqual(ok, true);
        assert.deepStrictEqual([unica(sombras).coincide, sombras[0].motivo], [false, "interruptor_distinto"]);
    } finally { process.env.REACCIONES_CACHE_MS = "0"; }
});

prueba("O5R-8 aislamiento: el interruptor de OTRO cliente no cuenta; socket de otro cliente → la sombra lo rechaza", async () => {
    escenario();
    db.tablas.configuracion_seleccion_mensajes.push({ usuario_id: B, tipo_respuesta: "reacciones_reserva", habilitada: false });
    const propio = await reaccionar(ctx(), "✅");
    assert.strictEqual(unica(propio.sombras).coincide, true);
    const ajeno = await reaccionar(ctx({ sock: { context: { usuarioId: B } } }), "✅");
    assert.strictEqual(ajeno.ok, true);
    assert.deepStrictEqual([unica(ajeno.sombras).coincide, ajeno.sombras[0].motivo], [false, "error_orquestador:sesion_de_otro_cliente"]);
});

prueba("O5R-9 si la sombra entera falla, la reacción y su resultado no cambian", async () => {
    escenario();
    const ruta = r("bot/funciones/reservas/sombraReacciones.js");
    const original = require.cache[ruta];
    inyectar(ruta, { compararReaccionEnSombra: async () => { throw new Error("explotó (simulado)"); } });
    try {
        const { ok, enviadas, todo } = await reaccionar(ctx(), "✅");
        assert.deepStrictEqual([ok, enviadas.length], [true, 1]);
        assert.ok(todo.some(l => l.includes("comparación omitida")));
    } finally { if (original) require.cache[ruta] = original; else delete require.cache[ruta]; }
});

prueba("O5R-10 la sombra no tiene envíos en su código y la línea no contiene el JID", async () => {
    escenario();
    const fuente = require("fs").readFileSync(r("bot/funciones/reservas/sombraReacciones.js"), "utf8");
    const creacion = fuente.slice(fuente.indexOf("crearOrquestador({"), fuente.indexOf("});", fuente.indexOf("crearOrquestador({")));
    assert.ok(!/envios\s*:/.test(creacion) && !/require\([^)]*(baileys|send)/.test(fuente));
    const { crudas } = await reaccionar(ctx(), "✅");
    assert.ok(!crudas[0].includes("573001112233"));
});

ejecutar("O5 · Reacciones en modo sombra").finally(() => { delete process.env.MENSAJES_ORQUESTADOR_REACCION; });
