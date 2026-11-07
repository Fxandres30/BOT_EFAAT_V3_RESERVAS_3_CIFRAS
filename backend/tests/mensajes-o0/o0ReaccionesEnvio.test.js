// ==========================================================================
// FASE O0 — CARACTERIZACIÓN del motor 6 (REACCIONES ✅/❌ a las reservas) y
// de la CAPA COMÚN DE ENVÍO (services/baileys/send.js), que comparten todos
// los motores.
//
// Reales: reaccionReserva.js, send.js (sendMessage, sendImage,
// sendReaction), mensajesEnviados.js. Simulados: Supabase (memoria) y el
// socket de WhatsApp. Los tiempos de «escribiendo…» se aceleran a 0.
//
//     node backend/tests/mensajes-o0/o0ReaccionesEnvio.test.js
// ==========================================================================

"use strict";

process.env.REACCIONES_CACHE_MS = "0"; // sin caché entre casos (el real usa 30 s)

const assert = require("assert");
const { r, inyectar, crearDb, silencio } = require("./_comun");
const { prueba, riesgo, ejecutar } = require("../caracterizacion/_prueba");

let db = crearDb();
inyectar(r("lib/supabase.js"), { from: (t) => db.client.from(t) });

const reaccion = require(r("bot/funciones/reservas/reaccionReserva.js"));
const send = require(r("services/baileys/send.js"));
const { fueEnviadoPorPrograma } = require(r("bot/utils/mensajesEnviados.js"));

const A = "tenant-A";

function crearSock(usuarioId = A) {
    const llamadas = { envios: [], presencia: [] };
    const sock = {
        context: { usuarioId, sessionId: `ses-${usuarioId}`, telefono: "573000000000", estado: "conectado" },
        user: { id: "573000000000:1@s.whatsapp.net" },
        sendPresenceUpdate: async (estado, jid) => { llamadas.presencia.push([estado, jid]); },
        sendMessage: async (jid, contenido, opciones) => { llamadas.envios.push({ jid, contenido, opciones }); return { key: { id: opciones?.messageId } }; }
    };
    return { sock, llamadas };
}

let sec = 0;
function ctx(extra = {}) {
    const { sock } = crearSock();
    return { sock, session: { usuarioId: A }, chat: { remoteJid: "g1@g.us", esGrupo: true }, message: { key: { id: `K${++sec}`, remoteJid: "g1@g.us", fromMe: false } }, ...extra };
}

// =========================================================== REACCIONES ===

prueba("RE1 decisión: todos reservados → ✅; todos ocupados por otros → ❌; mezcla o nada → sin reacción", () => {
    const libres = (ns) => ns.map(numero => ({ numero }));
    assert.strictEqual(reaccion.decidirReaccion({ solicitados: ["1", "2"], resultado: { disponibles: libres(["1", "2"]) }, reservados: ["1", "2"] }), "✅");
    assert.strictEqual(reaccion.decidirReaccion({ solicitados: ["1"], resultado: { ocupadosPorOtros: libres(["1"]) } }), "❌");
    assert.strictEqual(reaccion.decidirReaccion({ solicitados: ["1", "2"], resultado: { disponibles: libres(["1"]), ocupadosPorOtros: libres(["2"]) }, reservados: ["1"] }), null);
    assert.strictEqual(reaccion.decidirReaccion({ solicitados: ["1"], resultado: { disponibles: libres(["1"]) }, reservados: [] }), null);
    assert.strictEqual(reaccion.decidirReaccion({ solicitados: [], resultado: {} }), null);
});

prueba("RE2 solo en grupos y nunca a mensajes propios; una sola vez por mensaje", async () => {
    db = crearDb();
    const enviadas = [];
    const enviar = async (x) => { enviadas.push(x); };
    const c = ctx();
    assert.strictEqual(await silencio(() => reaccion.reaccionarAlMensaje({ ctx: c, emoji: "✅", enviar })), true);
    assert.strictEqual(await silencio(() => reaccion.reaccionarAlMensaje({ ctx: c, emoji: "✅", enviar })), false);
    assert.strictEqual(await silencio(() => reaccion.reaccionarAlMensaje({ ctx: ctx({ chat: { remoteJid: "u@s.whatsapp.net", esGrupo: false } }), emoji: "✅", enviar })), false);
    const propio = ctx(); propio.message.key.fromMe = true;
    assert.strictEqual(await silencio(() => reaccion.reaccionarAlMensaje({ ctx: propio, emoji: "✅", enviar })), false);
    assert.strictEqual(enviadas.length, 1);
    assert.deepStrictEqual([enviadas[0].jid, enviadas[0].emoji, enviadas[0].key], ["g1@g.us", "✅", c.message.key]);
});

prueba("RE3 interruptor «reacciones_reserva»: apagado → sin reacción; sin fila → activado", async () => {
    db = crearDb({ configuracion_seleccion_mensajes: [{ usuario_id: A, tipo_respuesta: "reacciones_reserva", habilitada: false }] });
    const enviadas = [];
    assert.strictEqual(await silencio(() => reaccion.reaccionarAlMensaje({ ctx: ctx(), emoji: "❌", enviar: async (x) => enviadas.push(x) })), false);
    db = crearDb();
    assert.strictEqual(await silencio(() => reaccion.reaccionarAlMensaje({ ctx: ctx(), emoji: "❌", enviar: async (x) => enviadas.push(x) })), true);
});

prueba("RE4 si no se puede leer el interruptor → se usa el último valor conocido (por defecto, activado)", async () => {
    db = crearDb();
    db.forzarError("configuracion_seleccion_mensajes");
    assert.strictEqual(await silencio(() => reaccion.reaccionarAlMensaje({ ctx: ctx({ session: { usuarioId: "otro-tenant" } }), emoji: "✅", enviar: async () => {} })), true);
});

prueba("RE5 un fallo al reaccionar nunca lanza (la respuesta ya salió)", async () => {
    db = crearDb();
    const ok = await silencio(() => reaccion.reaccionarAlMensaje({ ctx: ctx(), emoji: "✅", enviar: async () => { throw new Error("WhatsApp (simulado)"); } }));
    assert.strictEqual(ok, false);
    riesgo("La marca «ya reaccionado» se guarda ANTES de enviar: si el envío de la reacción falla, ese mensaje ya no recibirá reacción en otro intento.");
});

// ===================================================== CAPA DE ENVÍO ===

prueba("EN1 sin socket → se rechaza (nunca usa el WhatsApp de otro cliente)", async () => {
    await assert.rejects(() => silencio(() => send.sendMessage({ sock: null, jid: "g@g.us", text: "x" })), /Envío sin socket/);
    await assert.rejects(() => silencio(() => send.sendImage({ sock: null, jid: "g@g.us", image: Buffer.from("x") })), /Envío sin socket/);
    await assert.rejects(() => silencio(() => send.sendReaction({ sock: null, jid: "g@g.us", key: {}, emoji: "✅" })), /Envío sin socket/);
});

prueba("EN2 texto: «escribiendo…» y «pausado» antes de enviar; cita el mensaje; id generado y registrado como salida de EFAAT", async () => {
    const { sock, llamadas } = crearSock();
    const citado = { key: { id: "C1" } };
    await silencio(() => send.sendMessage({ sock, jid: "g1@g.us", text: "Hola", quoted: citado }));
    assert.deepStrictEqual(llamadas.presencia, [["composing", "g1@g.us"], ["paused", "g1@g.us"]]);
    const e = llamadas.envios[0];
    assert.deepStrictEqual(e.contenido, { text: "Hola" });
    assert.strictEqual(e.opciones.quoted, citado);
    assert.ok(e.opciones.messageId && fueEnviadoPorPrograma(e.opciones.messageId));
});

prueba("EN3 imagen y reacción: sin «escribiendo…», con id registrado como salida de EFAAT", async () => {
    const { sock, llamadas } = crearSock();
    await silencio(() => send.sendImage({ sock, jid: "g1@g.us", image: Buffer.from("png"), caption: undefined }));
    await silencio(() => send.sendReaction({ sock, jid: "g1@g.us", key: { id: "K" }, emoji: "✅" }));
    assert.strictEqual(llamadas.presencia.length, 0);
    assert.deepStrictEqual(llamadas.envios[0].contenido.caption, "");
    assert.deepStrictEqual(llamadas.envios[1].contenido, { react: { text: "✅", key: { id: "K" } } });
    assert.ok(llamadas.envios.every(x => fueEnviadoPorPrograma(x.opciones.messageId)));
});

prueba("EN4 un error de WhatsApp se propaga al llamador (cada motor decide qué hacer)", async () => {
    const { sock } = crearSock();
    sock.sendMessage = async () => { throw new Error("rechazado (simulado)"); };
    await assert.rejects(() => silencio(() => send.sendMessage({ sock, jid: "g1@g.us", text: "x" })), /rechazado/);
});

// Acelera el «escribiendo…» (1 a 7 s reales) y el temporizador de diagnóstico.
const setTimeoutReal = global.setTimeout;
global.setTimeout = (fn, _ms, ...a) => setTimeoutReal(fn, 0, ...a);
ejecutar("O0 · Motor 6: reacciones y capa común de envío").finally(() => { global.setTimeout = setTimeoutReal; });
