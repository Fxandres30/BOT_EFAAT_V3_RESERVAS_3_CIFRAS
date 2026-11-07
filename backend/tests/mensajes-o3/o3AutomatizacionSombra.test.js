// ==========================================================================
// FASE O3 — AUTOMATIZACIÓN (OPEN, REMINDER, UPDATE, CLOSE) con el
// orquestador en MODO SOMBRA.
//
// Reales: engine.enviarMensajeProgramado / enviarMensajeApertura (con la
// llamada en sombra), messageSelector (con la foto de selección),
// repo/messages, variableResolver, executionGuard, send.js con socket
// simulado, automation/sombraAutomatizacion.js y shared/mensajes.
// Simulado: Supabase (fakeSupabaseAutomation, con UNIQUE real). La fake no
// pone el DEFAULT now() de usado_en: aquí se fecha cada uso al insertarlo,
// como haría Postgres (imprescindible para «no repetir el último»).
//
//     node backend/tests/mensajes-o3/o3AutomatizacionSombra.test.js
// ==========================================================================

"use strict";

delete process.env.MENSAJES_ORQUESTADOR_AUTOMATIZACION;

const assert = require("assert");
const path = require("path");
const { prueba, ejecutar } = require("../caracterizacion/_prueba");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);
const inyectar = (ruta, exp) => { require.cache[ruta] = { id: ruta, filename: ruta, loaded: true, exports: exp }; };

const prohibido = { ia: 0, chromium: 0 };
inyectar(r("bot/ai/aiService.js"), { suggestReply: async () => { prohibido.ia++; return {}; } });
inyectar(require.resolve("puppeteer", { paths: [RAIZ] }), { launch: async () => { prohibido.chromium++; throw new Error("Chromium prohibido"); } });

const { crearEntorno, acelerarTimers, restaurarTimers } = require("../mensajes/entornoFake");

const A = "usuario-A";
const B = "usuario-B";
const GRUPO = "573001112233-1111@g.us";

let ent;
let reloj = 0;

function escenario({ modo = "shadow" } = {}) {
    if (modo) process.env.MENSAJES_ORQUESTADOR_AUTOMATIZACION = modo; else delete process.env.MENSAJES_ORQUESTADOR_AUTOMATIZACION;
    ent = crearEntorno();
    prohibido.ia = 0; prohibido.chromium = 0;
    // DEFAULT now() de usado_en, en orden estricto.
    const client = ent.fakeSupabase.client;
    const desde = client.from.bind(client);
    client.from = (tabla) => {
        const b = desde(tabla);
        if (tabla === "automation_message_uses") {
            const insertar = b.insert.bind(b);
            b.insert = (fila) => insertar({ usado_en: new Date(Date.UTC(2026, 0, 1, 0, 0, ++reloj)).toISOString(), ...fila });
        }
        return b;
    };
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
// Envía con el motor actual capturando consola: textos enviados y líneas de sombra.
async function enviar({ tipo = "REMINDER_MESSAGE", categoria = null, evento = EVENTO, clave, s, variablesExtra, azar = null, apertura = false } = {}) {
    s = s || ent.crearFakeSock({ usuarioId: evento.usuario_id });
    const capturadas = [];
    const { log, warn, error } = console;
    console.log = console.warn = console.error = (...a) => capturadas.push(a.map(String).join(" "));
    const realRandom = Math.random;
    if (azar != null) Math.random = () => azar;
    let res;
    try {
        res = apertura
            ? await ent.engine.enviarMensajeApertura(evento, SESION, s.sock)
            : await ent.engine.enviarMensajeProgramado({ evento, eventSession: SESION, sock: s.sock, tipo, categoria, claveIdempotencia: clave || `clave-${++n}`, tipoAccion: tipo, variablesExtra });
    } finally {
        Math.random = realRandom;
        Object.assign(console, { log, warn, error });
    }
    const crudas = capturadas.filter(l => l.startsWith("[MENSAJES SOMBRA]"));
    return {
        res, s,
        texto: s.llamadas.sendMessage.at(-1)?.contenido?.text,
        sombras: crudas.map(l => JSON.parse(l.slice("[MENSAJES SOMBRA] ".length))),
        crudas, todo: capturadas
    };
}

const tabla = (t) => ent.fakeSupabase._tablas[t];

// ================================================================== off ===

prueba("O3-1 sin la variable (off): mismo envío, ninguna línea de sombra", async () => {
    escenario({ modo: null });
    mensaje({ texto: "HOLA {nombre_evento}" });
    const { texto, sombras } = await enviar();
    assert.strictEqual(texto, "HOLA Sinuano Día");
    assert.strictEqual(sombras.length, 0);
});

// ============================================================ 4 tipos ===

prueba("O3-2 los cuatro tipos: envío idéntico y comparación coincidente (tipo, acción y clave)", async () => {
    escenario();
    for (const tipo of ["REMINDER_MESSAGE", "UPDATE_MESSAGE", "CLOSE_MESSAGE"]) mensaje({ tipo, texto: `${tipo} de {nombre_evento}` });
    mensaje({ tipo: "OPEN_MESSAGE", texto: "ABRIMOS {nombre_evento}" });
    for (const tipo of ["REMINDER_MESSAGE", "UPDATE_MESSAGE", "CLOSE_MESSAGE"]) {
        const { texto, sombras } = await enviar({ tipo, clave: `es-1:${tipo}` });
        assert.strictEqual(texto, `${tipo} de Sinuano Día`);
        assert.deepStrictEqual([sombras.length, sombras[0].tipo, sombras[0].tipoAccion, sombras[0].coincide, sombras[0].orquestador.estado], [1, tipo, tipo, true, "sombra"]);
    }
    const abre = await enviar({ apertura: true });
    assert.strictEqual(abre.texto, "ABRIMOS Sinuano Día");
    assert.deepStrictEqual([abre.sombras[0].tipo, abre.sombras[0].coincide], ["OPEN_MESSAGE", true]);
    assert.ok(tabla("automation_actions").some(a => a.clave_idempotencia === "es-1:OPEN_MESSAGE"));
});

// ===================================================== no repetir el último ===

prueba("O3-3 CLAVE: «no repetir el último» — la sombra usa el último uso ANTERIOR al registro del motor (6 envíos alternos, todos coinciden)", async () => {
    escenario();
    mensaje({ texto: "X" }); mensaje({ texto: "Y" });
    const textos = [];
    for (let i = 0; i < 6; i++) {
        const { texto, sombras } = await enviar({ azar: 0 });
        textos.push(texto);
        const s = sombras[0];
        assert.strictEqual(s.coincide, true, JSON.stringify(s));
        assert.strictEqual(s.seleccion.ultimoUsoOrquestador, i === 0 ? null : s.seleccion.ultimoUsoActual, JSON.stringify(s.seleccion));
    }
    assert.deepStrictEqual(textos, ["X", "Y", "X", "Y", "X", "Y"]);
    assert.strictEqual(tabla("automation_message_uses").length, 6, "solo los usos del motor");
});

prueba("O3-4 con un único mensaje se repite; el motor ni lee el último uso y la sombra coincide", async () => {
    escenario();
    mensaje({ texto: "SOLO" });
    await enviar();
    const { texto, sombras } = await enviar();
    assert.strictEqual(texto, "SOLO");
    assert.deepStrictEqual([sombras[0].seleccion.ultimoUsoActual, sombras[0].coincide], ["no_leido", true]);
});

prueba("O3-5 mismo azar: con 3 candidatas y azar 0.99, motor y sombra eligen la misma", async () => {
    escenario();
    mensaje({ texto: "A" }); mensaje({ texto: "B" }); mensaje({ texto: "C" });
    const { texto, sombras } = await enviar({ azar: 0.99 });
    assert.strictEqual(texto, "C");
    assert.deepStrictEqual([sombras[0].seleccion.azar, sombras[0].coincide], [0.99, true]);
});

// =============================================== propios, globales, aislamiento ===

prueba("O3-6 propios + globales: las mismas candidatas en el mismo orden; los de otro cliente no entran", async () => {
    escenario();
    const propio = mensaje({ texto: "PROPIO" });
    const global = mensaje({ usuarioId: null, texto: "GLOBAL" });
    mensaje({ usuarioId: B, texto: "DE B" });
    const { texto, sombras } = await enviar({ azar: 0.99 });
    assert.strictEqual(texto, "GLOBAL");
    const s = sombras[0];
    assert.deepStrictEqual(s.seleccion.candidatasActuales, [propio.id, global.id]);
    assert.deepStrictEqual(s.seleccion.candidatasOrquestador, [propio.id, global.id]);
    assert.strictEqual(s.coincide, true);
});

prueba("O3-7 categoría: filtra igual en ambos; categoría sin mensajes → ninguno envía (coincide)", async () => {
    escenario();
    mensaje({ categoria: "humor", texto: "HUM" }); mensaje({ categoria: "urgencia", texto: "URG" });
    const humor = await enviar({ categoria: "humor" });
    assert.deepStrictEqual([humor.texto, humor.sombras[0].coincide, humor.sombras[0].categoria], ["HUM", true, "humor"]);
    const vacia = await enviar({ categoria: "escasez" });
    assert.deepStrictEqual([vacia.res.motivo, vacia.sombras[0].actual.estado, vacia.sombras[0].orquestador.motivo, vacia.sombras[0].coincide], ["sin_mensajes_disponibles", "sin_mensajes_disponibles", "sin_plantillas", true]);
});

prueba("O3-8 aislamiento: el cliente B sin mensajes propios no ve los de A (ambos lados)", async () => {
    escenario();
    mensaje({ texto: "DE A" });
    const deB = await enviar({ evento: { ...EVENTO, usuario_id: B } });
    assert.deepStrictEqual([deB.res.enviado, deB.sombras[0].usuarioId, deB.sombras[0].orquestador.motivo, deB.sombras[0].coincide], [false, B, "sin_plantillas", true]);
});

// ===================================================== variables y formatos ===

prueba("O3-9 variables y formato: crudos (AU5), modificador literal (AU7) y variablesExtra que pisan (AU8), todo igual", async () => {
    escenario();
    mensaje({ texto: "{nombre_evento}|{hora_cierre}|{valor}|{{evento|upper}}|{libres_vivo}" });
    const { texto, sombras } = await enviar({ variablesExtra: { libres_vivo: 42, nombre_evento: "PISADO" } });
    assert.strictEqual(texto, "PISADO|14:26|1500|{{evento|upper}}|42");
    const s = sombras[0];
    assert.deepStrictEqual([s.coincide, s.variables.coinciden], [true, true]);
    assert.strictEqual(s.variables.huellaActual, s.variables.huellaOrquestador);
});

prueba("O3-10 variable faltante: el motor no envía ni consume la clave; la sombra tampoco y señala las mismas faltantes", async () => {
    escenario();
    mensaje({ texto: "Quedan {disponibles} — {inventada}" });
    const { res, sombras } = await enviar({ clave: "k-falta" });
    assert.deepStrictEqual([res.enviado, res.motivo], [false, "variable_faltante"]);
    const s = sombras[0];
    assert.deepStrictEqual([s.orquestador.estado, s.orquestador.motivo, s.variables.faltantesOrquestador, s.coincide], ["omitido", "variable_faltante", ["inventada"], true]);
    assert.strictEqual(tabla("automation_actions").length, 0);
});

// ===================================================== duplicados ===

prueba("O3-11 duplicados: la misma clave dos veces → un envío; la segunda vez no se compara (ya resuelta)", async () => {
    escenario();
    mensaje({ texto: "UNA VEZ" });
    const s = ent.crearFakeSock({ usuarioId: A });
    const a = await enviar({ clave: "k-unica", s });
    const b = await enviar({ clave: "k-unica", s });
    assert.deepStrictEqual([a.sombras.length, b.sombras.length, b.res.motivo], [1, 0, "ya_ok"]);
    assert.strictEqual(s.llamadas.sendMessage.length, 1);
});

prueba("O3-12 concurrencia: dos envíos simultáneos con la misma clave → un envío y una sola comparación", async () => {
    escenario();
    mensaje({ texto: "CARRERA" });
    const s = ent.crearFakeSock({ usuarioId: A });
    const [x, y] = await Promise.all([enviar({ clave: "k-c", s }), enviar({ clave: "k-c", s })]);
    assert.strictEqual(s.llamadas.sendMessage.length, 1);
    assert.strictEqual(x.sombras.length + y.sombras.length, 1);
});

// ===================================================== sin efectos ===

prueba("O3-13 sin efectos: la sombra no añade usos, acciones ni mensajes; solo lo del motor", async () => {
    escenario();
    mensaje({ texto: "X" }); mensaje({ texto: "Y" }); mensaje({ usuarioId: null, texto: "G" });
    const mensajesAntes = JSON.stringify(tabla("automation_messages"));
    for (let i = 0; i < 3; i++) await enviar({ clave: `k-${i}` });
    assert.strictEqual(tabla("automation_message_uses").length, 3);
    assert.strictEqual(tabla("automation_actions").length, 3);
    assert.ok(tabla("automation_actions").every(a => a.estado === "ok"));
    assert.strictEqual(JSON.stringify(tabla("automation_messages")), mensajesAntes);
});

prueba("O3-14 la sombra se crea sin funciones de envío ni guardián y no importa send/executionGuard/IA", () => {
    const fuente = require("fs").readFileSync(r("automation/sombraAutomatizacion.js"), "utf8");
    const creacion = fuente.slice(fuente.indexOf("crearOrquestador({"), fuente.indexOf("});", fuente.indexOf("crearOrquestador({")));
    assert.ok(!/envios\s*:/.test(creacion) && !/guardian\s*:/.test(creacion), creacion);
    assert.ok(!/require\([^)]*(baileys|send"|executionGuard|aiService|compartirTabla|puppeteer)/.test(fuente));
    assert.ok(!/\.(insert|update|upsert|delete)\(/.test(fuente), "la sombra no escribe");
});

// ===================================================== diferencias ===

prueba("O3-15 diferencia real: los mensajes cambian entre la selección del motor y la sombra → candidatas_distintas", async () => {
    escenario();
    mensaje({ texto: "VIEJO" });
    const s = ent.crearFakeSock({ usuarioId: A });
    const enviarReal = s.sock.sendMessage;
    s.sock.sendMessage = async (...a) => { mensaje({ texto: "NUEVO" }); return enviarReal(...a); };
    const { texto, sombras } = await enviar({ s });
    assert.strictEqual(texto, "VIEJO", "el envío real no cambia");
    assert.deepStrictEqual([sombras[0].coincide, sombras[0].motivo], [false, "candidatas_distintas"]);
});

prueba("O3-16 diferencia real: aparece otro uso entre la lectura del motor y su registro → ultimo_uso_distinto", async () => {
    escenario();
    const x = mensaje({ texto: "X" }); mensaje({ texto: "Y" });
    await enviar({ azar: 0 }); // usa X
    const s = ent.crearFakeSock({ usuarioId: A });
    const enviarReal = s.sock.sendMessage;
    s.sock.sendMessage = async (...a) => {
        tabla("automation_message_uses").push({ id: "intruso", message_id: "otro-mensaje", usuario_id: A, grupo_id: GRUPO, tipo: "REMINDER_MESSAGE", usado_en: new Date(Date.UTC(2026, 0, 1, 0, 0, ++reloj)).toISOString() });
        return enviarReal(...a);
    };
    const { sombras } = await enviar({ s, azar: 0 });
    assert.strictEqual(sombras[0].seleccion.ultimoUsoActual, x.id);
    assert.deepStrictEqual([sombras[0].coincide, sombras[0].motivo], [false, "ultimo_uso_distinto"]);
});

// ===================================================== fallos ===

prueba("O3-17 si falla la lectura del último uso en la sombra, el envío real sigue y se informa el error", async () => {
    escenario();
    mensaje({ texto: "X" }); mensaje({ texto: "Y" });
    const client = ent.fakeSupabase.client;
    const desde = client.from;
    let lecturasUsos = 0;
    client.from = (t) => {
        const b = desde(t);
        if (t === "automation_message_uses") {
            const limitar = b.limit.bind(b);
            b.limit = (k) => { if (k === 2) throw new Error("lectura caída (simulado)"); lecturasUsos++; return limitar(k); };
        }
        return b;
    };
    const { texto, sombras } = await enviar();
    assert.ok(["X", "Y"].includes(texto));
    assert.ok(String(sombras[0].seleccion.ultimoUsoOrquestador).startsWith("error:"));
    assert.ok(lecturasUsos >= 1, "la lectura del motor sí ocurrió");
});

prueba("O3-18 si el módulo de sombra entero falla, el motor envía y registra igual", async () => {
    escenario();
    mensaje({ texto: "HOLA" });
    const ruta = r("automation/sombraAutomatizacion.js");
    const original = require.cache[ruta];
    inyectar(ruta, { compararAutomatizacionEnSombra: async () => { throw new Error("explotó (simulado)"); } });
    try {
        const { res, texto, todo } = await enviar({ clave: "k-x" });
        assert.deepStrictEqual([res.enviado, texto], [true, "HOLA"]);
        assert.ok(todo.some(l => l.includes("comparación omitida") && l.includes("explotó")));
        assert.strictEqual(tabla("automation_message_uses").length, 1);
        assert.strictEqual(tabla("automation_actions")[0].estado, "ok");
    } finally {
        if (original) require.cache[ruta] = original; else delete require.cache[ruta];
    }
});

prueba("O3-19 si WhatsApp falla en el envío real (sin uso registrado), la sombra compara con el último uso correcto", async () => {
    escenario();
    const x = mensaje({ texto: "X" }); mensaje({ texto: "Y" });
    await enviar({ azar: 0 }); // usa X
    const s = ent.crearFakeSock({ usuarioId: A });
    s.sock.sendMessage = async () => { throw new Error("rechazado (simulado)"); };
    const { res, sombras } = await enviar({ s, azar: 0 });
    assert.strictEqual(res.enviado, false);
    assert.deepStrictEqual([sombras[0].actual.estado, sombras[0].seleccion.ultimoUsoOrquestador, sombras[0].coincide], ["fallo_envio", x.id, true]);
});

// ===================================================== modo, IA, privacidad ===

prueba("O3-20 con «active» configurado, en O3 es SOLO sombra (un único envío, el del motor)", async () => {
    escenario({ modo: "active" });
    mensaje({ texto: "HOLA" });
    const { s, sombras } = await enviar();
    assert.strictEqual(s.llamadas.sendMessage.length, 1);
    assert.deepStrictEqual([sombras[0].orquestador.estado, sombras[0].modoConfigurado], ["sombra", "active"]);
    assert.ok(sombras[0].aviso);
});

prueba("O3-21 ni IA ni imágenes; la línea no contiene el JID del grupo ni teléfonos", async () => {
    escenario();
    mensaje({ texto: "Paga al 3001234567 · {nombre_evento}" });
    const { crudas, sombras } = await enviar();
    assert.deepStrictEqual(prohibido, { ia: 0, chromium: 0 });
    assert.ok(!crudas[0].includes("573001112233") && !crudas[0].includes(GRUPO));
    assert.strictEqual(sombras[0].actual.vistaPrevia, "Paga al ••• · Sinuano Día");
});

acelerarTimers();
ejecutar("O3 · Automatización en modo sombra").finally(() => { restaurarTimers(); delete process.env.MENSAJES_ORQUESTADOR_AUTOMATIZACION; });
