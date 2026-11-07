// ==========================================================================
// FASE O0 — CARACTERIZACIÓN del motor 2: AUTOMATIZACIÓN (apertura,
// recordatorio, actualización y cierre: engine.enviarMensajeProgramado).
//
// Reales: engine.js, messageSelector.js, variableResolver.js,
// repo/messages.js, executionGuard.js y services/baileys/send.js (con un
// socket simulado). Simulado: Supabase (tests/automation/
// fakeSupabaseAutomation.js, con UNIQUE real en automation_actions).
//
//     node backend/tests/mensajes-o0/o0Automatizacion.test.js
// ==========================================================================

"use strict";

const assert = require("assert");
const { crearEntorno, acelerarTimers, restaurarTimers } = require("../mensajes/entornoFake");
const { silencio, conAzar } = require("./_comun");
const { prueba, riesgo, ejecutar } = require("../caracterizacion/_prueba");

const A = "usuario-A";
const B = "usuario-B";
const GRUPO = "573000000000-1111@g.us";

let ent;

function escenario() {
    ent = crearEntorno();
}

function mensaje({ usuarioId = A, tipo = "REMINDER_MESSAGE", categoria = null, texto = "T", activo = true } = {}) {
    return ent.fakeSupabase._agregar("automation_messages", { usuario_id: usuarioId, nombre_interno: texto, texto, tipo, categoria, activo });
}

const EVENTO = {
    id: "ev-1", usuario_id: A, grupo_id: GRUPO, nombre_evento: "Sinuano Día",
    hora_fin: "14:30", hora_cierre: "14:26", fecha_evento: "2026-09-09", valor: 1500,
    premios: [{ premio: 60000 }], reservados: 3, libres: 97
};
const SESION = { id: "es-1", grupo_id: GRUPO, usuario_id: A };

let n = 0;
async function enviar({ tipo = "REMINDER_MESSAGE", categoria = null, evento = EVENTO, clave, sock, variablesExtra } = {}) {
    const s = sock || ent.crearFakeSock({ usuarioId: A });
    const res = await silencio(() => ent.engine.enviarMensajeProgramado({
        evento, eventSession: SESION, sock: s.sock, tipo, categoria,
        claveIdempotencia: clave || `clave-${++n}`, tipoAccion: tipo, variablesExtra
    }));
    const texto = s.llamadas.sendMessage.at(-1)?.contenido?.text;
    return { res, texto, llamadas: s.llamadas, s };
}

const tabla = (t) => ent.fakeSupabase._tablas[t];

prueba("AU1 aleatorio entre los mensajes ACTIVOS del tipo: propios + globales (sin dueño)", async () => {
    escenario();
    mensaje({ texto: "PROPIO" });
    mensaje({ usuarioId: null, texto: "GLOBAL" });
    mensaje({ texto: "INACTIVO", activo: false });
    mensaje({ tipo: "CLOSE_MESSAGE", texto: "OTRO TIPO" });
    const a = await conAzar([0.0], () => enviar());
    const b = await conAzar([0.99], () => enviar());
    assert.deepStrictEqual([a.texto, b.texto].sort(), ["GLOBAL", "PROPIO"]);
});

prueba("AU2 sin repetir el último usado en ese grupo y tipo (si hay alternativa)", async () => {
    escenario();
    mensaje({ texto: "X" }); mensaje({ texto: "Y" });
    const salidas = [];
    for (let i = 0; i < 6; i++) {
        salidas.push((await conAzar([0.0], () => enviar())).texto);
        // La fake no pone el DEFAULT now() de usado_en: se fecha cada uso
        // en orden, como haría Postgres.
        tabla("automation_message_uses").forEach((u, j) => { u.usado_en = u.usado_en || new Date(Date.UTC(2026, 0, 1, 0, 0, i * 10 + j)).toISOString(); });
    }
    for (let i = 1; i < salidas.length; i++) assert.notStrictEqual(salidas[i], salidas[i - 1], salidas.join(","));
});

prueba("AU3 con un único mensaje, se repite (no hay alternativa)", async () => {
    escenario();
    mensaje({ texto: "SOLO" });
    assert.strictEqual((await enviar()).texto, "SOLO");
    assert.strictEqual((await enviar()).texto, "SOLO");
});

prueba("AU4 categoría: filtra por ella; null = cualquiera; categoría sin mensajes → no envía nada", async () => {
    escenario();
    mensaje({ categoria: "urgencia", texto: "URG" });
    mensaje({ categoria: "humor", texto: "HUM" });
    assert.strictEqual((await enviar({ categoria: "humor" })).texto, "HUM");
    const vacia = await enviar({ categoria: "escasez" });
    assert.deepStrictEqual([vacia.res.enviado, vacia.res.motivo], [false, "sin_mensajes_disponibles"]);
    assert.strictEqual(vacia.llamadas.sendMessage.length, 0);
});

prueba("AU5 variables: {x} y {{x}}; valores CRUDOS del evento (hora 24 h, valor y premio sin formato)", async () => {
    escenario();
    mensaje({ texto: "{nombre_evento}|{{loteria}}|{hora_cierre}|{valor}|{premio}|{reservados}|{disponibles}|{fecha}" });
    const { texto } = await enviar();
    assert.strictEqual(texto, "Sinuano Día|Sinuano Día|14:26|1500|60000|3|97|2026-09-09");
    riesgo("Automatización muestra la hora en 24 h y el valor/premio sin formato (14:26, 1500), mientras las respuestas usan 12 h y $ con miles.");
});

prueba("AU6 variable que el evento no tiene → NO se envía y NO se consume la clave de envío único", async () => {
    escenario();
    mensaje({ texto: "Quedan {disponibles} — {inventada}" });
    const { res, llamadas } = await enviar({ clave: "k-faltante" });
    assert.deepStrictEqual([res.enviado, res.motivo, res.faltantes], [false, "variable_faltante", ["inventada"]]);
    assert.strictEqual(llamadas.sendMessage.length, 0);
    assert.strictEqual(tabla("automation_actions").length, 0);
});

prueba("AU7 modificadores ({{x|upper}}) NO existen aquí: el texto sale con las llaves literales", async () => {
    escenario();
    mensaje({ texto: "Hoy {{evento|upper}}" });
    const { texto, res } = await enviar();
    assert.strictEqual(res.enviado, true);
    assert.strictEqual(texto, "Hoy {{evento|upper}}");
    riesgo("Un modificador como {{evento|upper}} en un mensaje de automatización se envía literal, con llaves (el resolvedor no lo reconoce y no lo bloquea).");
});

prueba("AU8 variablesExtra completan datos en vivo sin pisar los del evento", async () => {
    escenario();
    mensaje({ texto: "{nombre_evento} · {libres_vivo}" });
    const { texto } = await enviar({ variablesExtra: { libres_vivo: 42, nombre_evento: "IGNORADO?" } });
    assert.strictEqual(texto, "IGNORADO? · 42");
    riesgo("variablesExtra SÍ pisa los datos del evento (se combinan con {...evento, ...extra}), al contrario de lo que dice el comentario de engine.js.");
});

prueba("AU9 envío único: la misma clave dos veces → un solo envío; el segundo devuelve ya_ok", async () => {
    escenario();
    mensaje({ texto: "UNA VEZ" });
    const s = ent.crearFakeSock({ usuarioId: A });
    const r1 = await enviar({ clave: "k-unica", sock: s });
    const r2 = await enviar({ clave: "k-unica", sock: s });
    assert.strictEqual(r1.res.enviado, true);
    assert.deepStrictEqual([r2.res.enviado, r2.res.motivo], [false, "ya_ok"]);
    assert.strictEqual(s.llamadas.sendMessage.length, 1);
});

prueba("AU10 dos envíos simultáneos con la misma clave → uno solo (UNIQUE en automation_actions)", async () => {
    escenario();
    mensaje({ texto: "CARRERA" });
    const s = ent.crearFakeSock({ usuarioId: A });
    const [r1, r2] = await Promise.all([enviar({ clave: "k-carrera", sock: s }), enviar({ clave: "k-carrera", sock: s })]);
    assert.strictEqual([r1.res.enviado, r2.res.enviado].filter(Boolean).length, 1);
    assert.strictEqual(s.llamadas.sendMessage.length, 1);
});

prueba("AU11 registro de uso SOLO tras un envío correcto; si WhatsApp falla, la acción queda en error y sin uso", async () => {
    escenario();
    mensaje({ texto: "OK" });
    await enviar({ clave: "k-ok" });
    assert.strictEqual(tabla("automation_message_uses").length, 1);
    const s = ent.crearFakeSock({ usuarioId: A });
    s.sock.sendMessage = async () => { throw new Error("WhatsApp rechazó (simulado)"); };
    const fallo = await enviar({ clave: "k-falla", sock: s });
    assert.strictEqual(fallo.res.enviado, false);
    assert.strictEqual(tabla("automation_message_uses").length, 1);
    assert.strictEqual(tabla("automation_actions").find(a => a.clave_idempotencia === "k-falla").estado, "error");
});

prueba("AU12 aislamiento: nunca selecciona mensajes de otro cliente", async () => {
    escenario();
    mensaje({ usuarioId: B, texto: "DE B" });
    const { res } = await enviar();
    assert.deepStrictEqual([res.enviado, res.motivo], [false, "sin_mensajes_disponibles"]);
});

prueba("AU13 sin event_session → no se envía (motivo sin_event_session)", async () => {
    escenario();
    mensaje({ texto: "X" });
    const res = await silencio(() => ent.engine.enviarMensajeProgramado({ evento: EVENTO, eventSession: null, sock: {}, tipo: "OPEN_MESSAGE", claveIdempotencia: "k", tipoAccion: "OPEN_MESSAGE" }));
    assert.deepStrictEqual(res, { enviado: false, motivo: "sin_event_session" });
});

prueba("AU14 apertura = mismo camino con tipo OPEN_MESSAGE, sin categoría y clave «<sesión>:OPEN_MESSAGE»", async () => {
    escenario();
    mensaje({ tipo: "OPEN_MESSAGE", categoria: "humor", texto: "ABRIMOS {nombre_evento}" });
    const s = ent.crearFakeSock({ usuarioId: A });
    const res = await silencio(() => ent.engine.enviarMensajeApertura(EVENTO, SESION, s.sock));
    assert.strictEqual(res.enviado, true);
    assert.strictEqual(s.llamadas.sendMessage[0].contenido.text, "ABRIMOS Sinuano Día");
    assert.ok(tabla("automation_actions").some(a => a.clave_idempotencia === "es-1:OPEN_MESSAGE"));
});

acelerarTimers();
ejecutar("O0 · Motor 2: automatización (apertura, recordatorio, actualización, cierre)").finally(restaurarTimers);
