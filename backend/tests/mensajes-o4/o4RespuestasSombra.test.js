// ==========================================================================
// FASE O4 — RESPUESTAS A RESERVAS Y CONSULTAS con el orquestador en MODO
// SOMBRA.
//
// Reales: responderResultado.js (con la llamada en sombra), configMensajes,
// seleccionarPlantilla, plantillaMensaje, gramatica, shared/variables,
// resolverConsulta y sus consultas, bot/ai/sombraRespuestas.js y
// shared/mensajes. Simulados: Supabase (memoria, dos clientes), la IA (espía)
// y el envío por WhatsApp (espía).
//
//     node backend/tests/mensajes-o4/o4RespuestasSombra.test.js
// ==========================================================================

"use strict";

delete process.env.MENSAJES_ORQUESTADOR_RESPUESTA;

const assert = require("assert");
const { r, inyectar, crearDb, silencio, conAzar } = require("../mensajes-o0/_comun");
const { prueba, ejecutar } = require("../caracterizacion/_prueba");

const TABLA = "5k_15k_reservas_2_cifras";
const A = "tenant-A";
const B = "tenant-B";

let db = crearDb();
inyectar(r("lib/supabase.js"), { from: (t) => db.client.from(t) });

const espias = { ia: 0, iaFalla: false, enviados: [], alEnviar: null };
inyectar(r("bot/ai/aiService.js"), {
    suggestReply: async () => { espias.ia++; if (espias.iaFalla) throw new Error("IA caída"); return { respuesta: "TEXTO DE IA" }; }
});
inyectar(r("bot/ai/contextBuilder.js"), { construirContextoReserva: () => ({}) });
inyectar(r("shared/variables/variablesGlobalesRepo.js"), { obtenerVariablesActivas: async () => [] });
inyectar(r("services/baileys/send.js"), {
    sendMessage: async (args) => {
        if (espias.alEnviar) await espias.alEnviar(args);
        espias.enviados.push(args);
        return { key: { id: "x" } };
    },
    sendImage: async () => {}, sendReaction: async () => {}
});

const { responderResultado } = require(r("bot/ai/responderResultado.js"));
const { resolverConsulta } = require(r("bot/funciones/consultas/resolverConsulta.js"));

const EVENTO = { id: "ev-1", usuario_id: A, nombre_evento: "Lotería De Manizales", tabla: TABLA, cifras: 2, identidad_evento_real: "ident-1", hora_fin: "22:30", valor: 3000, activo: true, fecha_evento: null };
const USUARIO = { id: "u-1", nombre: "Carlos" };

let sec = 0;
function escenario({ modo = "shadow" } = {}) {
    if (modo) process.env.MENSAJES_ORQUESTADOR_RESPUESTA = modo; else delete process.env.MENSAJES_ORQUESTADOR_RESPUESTA;
    db = crearDb({ plantillas_mensaje: [], configuracion_seleccion_mensajes: [], eventos_bot: [], [TABLA]: [] });
    Object.assign(espias, { ia: 0, iaFalla: false, enviados: [], alEnviar: null });
    db.tablas[TABLA] = Array.from({ length: 100 }, (_, i) => ({ usuario_id: A, numero: String(i).padStart(2, "0"), estado: "libre", usuario_global_id: null }));
}
function plantilla(tipo, contenido, extra = {}, usuario = A) {
    const f = { id: `p-${++sec}`, usuario_id: usuario, tipo_respuesta: tipo, nombre: `P${sec}`, contenido, variables: {}, habilitada: true, orden: sec, ...extra };
    db.filas("plantillas_mensaje").push(f);
    return f;
}
function seleccion(tipo, extra = {}, usuario = A) {
    const f = { id: `cfg-${++sec}`, usuario_id: usuario, tipo_respuesta: tipo, modo_seleccion: "aleatorio", plantilla_fija_id: null, rotacion_indice: 0, habilitada: true, ...extra };
    db.filas("configuracion_seleccion_mensajes").push(f);
    return f;
}
function marcar(numeros, estado, dueno = USUARIO.id) {
    for (const n of numeros) Object.assign(db.tablas[TABLA].find(f => f.numero === n), { estado, usuario_global_id: dueno });
}
function ctxBase(extra = {}) {
    return {
        sock: { simulado: true }, session: { usuarioId: A, sessionId: "ses-A" },
        chat: { remoteJid: "573001112233-1111@g.us", esGrupo: true },
        message: { key: { id: `M${++sec}`, remoteJid: "573001112233-1111@g.us", fromMe: false } },
        usuario: USUARIO, evento: EVENTO, textoOriginal: "", ...extra
    };
}

// Ejecuta responderResultado capturando la consola.
async function responder(ctx, azar = null) {
    const capturadas = [];
    const { log, warn, error } = console;
    console.log = console.warn = console.error = (...a) => capturadas.push(a.map(x => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
    const real = Math.random;
    if (azar != null) Math.random = () => azar;
    let ok;
    try { ok = await responderResultado(ctx); } finally { Math.random = real; Object.assign(console, { log, warn, error }); }
    const crudas = capturadas.filter(l => l.startsWith("[MENSAJES SOMBRA]"));
    return { ok, texto: espias.enviados.at(-1)?.text, envio: espias.enviados.at(-1), sombras: crudas.map(l => JSON.parse(l.slice(18))), crudas, todo: capturadas };
}
const reserva = (res, extra = {}, azar) => responder(ctxBase({ reserva: res, ...extra }), azar);
async function consulta(intencion, extra = {}, azar) {
    const c = await silencio(() => resolverConsulta({ evento: extra.evento || EVENTO, usuario: USUARIO, ...intencion }));
    return responder(ctxBase({ consulta: c, ...extra }), azar);
}
const unica = (sombras) => { assert.strictEqual(sombras.length, 1, JSON.stringify(sombras)); return sombras[0]; };
const coincide = (s) => assert.strictEqual(s.coincide, true, JSON.stringify(s));
const escrituras = () => db.consultas.filter(c => c.operacion !== "select");

// ================================================================ off ===

prueba("O4-1 sin la variable (off): misma respuesta, ninguna línea de sombra, ninguna lectura extra", async () => {
    escenario({ modo: null });
    plantilla("reserva_completa", "Listo {{numeros_reservados}}");
    const { texto, sombras } = await reserva({ ok: true, reservados: ["07"], ocupados: [], mensaje: "F" });
    assert.strictEqual(texto, "Listo ( 07 )");
    assert.strictEqual(sombras.length, 0);
    assert.strictEqual(db.consultas.filter(c => c.tabla === "plantillas_mensaje").length, 1);
});

// ============================================================ reservas ===

prueba("O4-2 reservas: completa, parcial con anexo, número ocupado y todos ocupados → coinciden", async () => {
    escenario();
    plantilla("reserva_completa", "{{tu_numero_tus_numeros|capitalize}} {{numeros_reservados}} {{quedo_quedaron}} {{reservado_reservados}}");
    plantilla("reserva_parcial", "Reservados {{numeros_reservados}} · ocupados {{numeros_ocupados}}");
    plantilla("numero_ocupado", "{{numeros_solicitados}} ocupado");
    const casos = [
        [{ ok: true, reservados: ["01", "07"], ocupados: [], mensaje: "F" }, "Tus números ( 01 - 07 ) quedaron reservados"],
        [{ ok: true, reservados: ["27"], ocupados: ["45"], mensaje: "F", textoAdicional: "Ya es tuyo: ( 12 )" }, "Reservados ( 27 ) · ocupados ( 45 )\n\nYa es tuyo: ( 12 )"],
        [{ ok: false, ocupados: ["27"], mensaje: "F" }, "( 27 ) ocupado"],
        [{ ok: false, ocupados: ["27", "45"], mensaje: "FIJO-TODOS" }, "FIJO-TODOS"]
    ];
    for (const [res, esperado] of casos) {
        const { texto, sombras } = await reserva(res);
        assert.strictEqual(texto, esperado);
        const s = unica(sombras);
        coincide(s);
        assert.strictEqual(s.familia, "reserva");
    }
});

prueba("O4-3 reservas sin tipo (error técnico / ya eran suyos) → mensaje fijo en ambos (respuesta_fija)", async () => {
    escenario();
    const a = await reserva({ ok: false, errorTecnico: true, mensaje: "❌ No fue posible procesar tu reserva. Intenta nuevamente." });
    const b = await reserva({ ok: false, ocupados: [], mensaje: "YA-ERAN-TUYOS" });
    for (const x of [a, b]) {
        const s = unica(x.sombras);
        coincide(s);
        assert.deepStrictEqual([s.tipo, s.orquestador.fuente], ["respuesta_fija", "fijo"]);
    }
});

// ============================================================ consultas ===

prueba("O4-4 mis números (con números y SIN números → «ninguno», inconsistencia conservada) y «mis reservas» → coinciden", async () => {
    escenario();
    plantilla("mis_numeros", "🎟️ {{tu_numero_tus_numeros|capitalize}}: {{numeros_totales_cliente}}\n✅ {{numeros_pagados}}");
    const vacio = await consulta({ tipo: "mis_numeros" });
    assert.strictEqual(vacio.texto, "🎟️ Tus números: ninguno\n✅ ninguno");
    coincide(unica(vacio.sombras));
    marcar(["07"], "pagado"); marcar(["01"], "reservado");
    const con = await consulta({ tipo: "mis_reservas" });
    assert.strictEqual(con.texto, "🎟️ Tus números: ( 01 - 07 )\n✅ ( 07 )");
    const s = unica(con.sombras);
    coincide(s);
    assert.strictEqual(s.tipo, "mis_numeros");
});

prueba("O4-5 las cuatro situaciones de pago → mismo tipo, misma plantilla y mismo texto", async () => {
    escenario();
    for (const t of ["sin_pago", "pago_parcial", "pago_completo", "sin_saldo"]) plantilla(`consulta_pago_${t}`, `${t.toUpperCase()}: {{numeros_pendientes}} · {{monto_pendiente}}`);
    const tipos = [];
    const pasos = [() => {}, () => marcar(["10"], "reservado"), () => marcar(["11"], "pagado"), () => marcar(["10"], "pagado")];
    for (const paso of pasos) {
        paso();
        const { sombras } = await consulta({ tipo: "consulta_pago", modo: "resumen", bucket: "pendiente" });
        const s = unica(sombras);
        coincide(s);
        tipos.push(s.tipo);
    }
    assert.deepStrictEqual(tipos, ["consulta_pago_sin_saldo", "consulta_pago_sin_pago", "consulta_pago_pago_parcial", "consulta_pago_pago_completo"]);
});

prueba("O4-6 sin precio: las plantillas con montos se descartan en ambos (mismas candidatas)", async () => {
    escenario();
    marcar(["10"], "reservado");
    const conMonto = plantilla("consulta_pago_sin_pago", "Debes {{monto_pendiente}}");
    const sinMonto = plantilla("consulta_pago_sin_pago", "Te falta {{numeros_pendientes}}");
    const { texto, sombras } = await consulta({ tipo: "consulta_pago", modo: "resumen", bucket: "pendiente" }, { evento: { ...EVENTO, valor: 0 } });
    assert.strictEqual(texto, "Te falta ( 10 )");
    const s = unica(sombras);
    coincide(s);
    assert.deepStrictEqual(s.seleccion.candidatasOrquestador, [sinMonto.id]);
    assert.ok(!s.seleccion.candidatasActuales.includes(conMonto.id));
});

prueba("O4-7 preguntas puntuales de pago, sorteo no vigente y error técnico → solo mensaje fijo en ambos", async () => {
    escenario();
    marcar(["10"], "reservado"); marcar(["11"], "pagado");
    plantilla("consulta_pago_pago_parcial", "NO DEBE SALIR");
    plantilla("mis_numeros", "NO DEBE SALIR");
    const puntual = await consulta({ tipo: "consulta_pago", modo: "monto", bucket: "pagado" });
    assert.strictEqual(puntual.texto, "✅ Has pagado: $3.000.");
    const cerrado = await consulta({ tipo: "mis_numeros" }, { evento: { ...EVENTO, activo: false } });
    assert.strictEqual(cerrado.texto, "No hay un sorteo activo en este grupo en este momento.");
    db.forzarError(TABLA);
    const fallo = await consulta({ tipo: "disponibilidad" });
    for (const x of [puntual, cerrado, fallo]) { const s = unica(x.sombras); coincide(s); assert.strictEqual(s.orquestador.fuente, "fijo"); }
});

prueba("O4-8 disponibilidad con libres (cuadrícula) y agotado (filtro {{numeros_disponibles}}) → coinciden", async () => {
    escenario();
    plantilla("disponibilidad", "Quedan:\n{{numeros_disponibles}}");
    db.tablas[TABLA].forEach((f, i) => { if (i > 2) f.estado = "reservado"; });
    const libres = await consulta({ tipo: "disponibilidad" });
    coincide(unica(libres.sombras));
    db.tablas[TABLA].forEach(f => { f.estado = "reservado"; });
    plantilla("disponibilidad_agotada", "Lista {{numeros_disponibles}}");
    const buena = plantilla("disponibilidad_agotada", "🚫 AGOTADO {{evento}}");
    const agotado = await consulta({ tipo: "disponibilidad" });
    assert.strictEqual(agotado.texto, "🚫 AGOTADO Lotería De Manizales");
    const s = unica(agotado.sombras);
    coincide(s);
    assert.deepStrictEqual(s.seleccion.candidatasOrquestador, [buena.id]);
});

prueba("O4-9 estado de un número: con plantilla (sin estado, inconsistencia) y bloqueado (solo fijo) → coinciden", async () => {
    escenario();
    plantilla("numero_especifico", "Revisando {{numeros_solicitados}}");
    marcar(["23"], "reservado", "otro");
    coincide(unica((await consulta({ tipo: "numero_especifico", numeros: ["23"] })).sombras));
    db.tablas[TABLA].find(f => f.numero === "24").estado = "bloqueado";
    const bloq = await consulta({ tipo: "numero_especifico", numeros: ["24"] });
    assert.strictEqual(bloq.texto, "El número ( 24 ) está bloqueado y no se puede reservar por ahora.");
    coincide(unica(bloq.sombras));
});

prueba("O4-10 cantidad y consulta combinada → coinciden", async () => {
    escenario();
    marcar(["10"], "reservado"); marcar(["11"], "pagado");
    plantilla("cantidad_reservas", "Llevas {{cantidad}} {{numero_numeros}}");
    const cant = await consulta({ tipo: "cantidad_reservas" });
    assert.strictEqual(cant.texto, "Llevas 2 números");
    coincide(unica(cant.sombras));
    const comb = await consulta({ tipo: "multiple", intenciones: [{ tipo: "mis_numeros" }, { tipo: "consulta_pago", modo: "monto", bucket: "pendiente" }] });
    const s = unica(comb.sombras);
    coincide(s);
    assert.strictEqual(s.tipo, "multiple");
});

// ============================================================== IA ===

prueba("O4-11 información del sorteo sin plantillas: el motor usa IA UNA vez; la sombra no la llama y marca el texto como no comparable", async () => {
    escenario();
    const { texto, sombras } = await consulta({ tipo: "info_evento" });
    assert.strictEqual(texto, "TEXTO DE IA");
    assert.strictEqual(espias.ia, 1);
    const s = unica(sombras);
    coincide(s);
    assert.deepStrictEqual([s.textoComparable, s.orquestador.motivo, s.actual.fuente], [false, "ia_no_ejecutada_en_sombra", "ia"]);
});

prueba("O4-12 IA caída en el motor → mensaje fijo; la sombra reconoce la misma ruta (IA intentada)", async () => {
    escenario();
    espias.iaFalla = true;
    const { texto, sombras } = await consulta({ tipo: "info_evento" });
    assert.ok(texto.startsWith("Este sorteo es: Lotería De Manizales"));
    const s = unica(sombras);
    coincide(s);
    assert.deepStrictEqual([s.actual.fuente, s.actual.iaIntentada, s.textoComparable], ["fijo", true, false]);
    assert.strictEqual(espias.ia, 1);
});

prueba("O4-13 información del sorteo CON plantilla → texto comparable y coincide; la IA no se usa", async () => {
    escenario();
    plantilla("info_evento", "🎯 {{evento}} — {{hora}}");
    const { texto, sombras } = await consulta({ tipo: "info_evento" });
    assert.strictEqual(texto, "🎯 Lotería De Manizales — 10:30 PM");
    const s = unica(sombras);
    coincide(s);
    assert.deepStrictEqual([s.textoComparable, espias.ia], [true, 0]);
});

// ======================================================== interruptores ===

prueba("O4-14 interruptor apagado: el motor calla; la sombra también (coincide) y nada se envía", async () => {
    escenario();
    seleccion("reserva_completa", { habilitada: false });
    plantilla("reserva_completa", "NO");
    const { ok, sombras } = await reserva({ ok: true, reservados: ["1"], ocupados: [], mensaje: "F" });
    assert.strictEqual(ok, false);
    assert.strictEqual(espias.enviados.length, 0);
    const s = unica(sombras);
    coincide(s);
    assert.deepStrictEqual([s.actual.estado, s.orquestador.motivo], ["interruptor_apagado", "interruptor_apagado"]);
});

// ===================================================== selección y rotación ===

prueba("O4-15 rotación: el motor la avanza UNA vez antes de enviar; la sombra usa el índice previo y no escribe nada", async () => {
    escenario();
    ["A", "B", "C"].forEach(t => plantilla("reserva_completa", t));
    const cfg = seleccion("reserva_completa", { modo_seleccion: "rotacion", rotacion_indice: 1 });
    const { texto, sombras } = await reserva({ ok: true, reservados: ["1"], ocupados: [], mensaje: "F" });
    assert.strictEqual(texto, "B");
    assert.strictEqual(cfg.rotacion_indice, 2);
    const s = unica(sombras);
    coincide(s);
    assert.deepStrictEqual([s.seleccion.rotacionActual, s.seleccion.rotacionOrquestador, s.seleccion.rotacionGuardada], [2, 2, true]);
    assert.strictEqual(escrituras().length, 1, "solo la actualización de rotación del motor");
    const otra = await reserva({ ok: true, reservados: ["1"], ocupados: [], mensaje: "F" });
    assert.strictEqual(otra.texto, "C");
    coincide(unica(otra.sombras));
    assert.strictEqual(cfg.rotacion_indice, 0);
});

prueba("O4-16 aleatorio con el mismo azar y fijo (incluida la fija deshabilitada → respaldo) → coinciden", async () => {
    escenario();
    ["A", "B", "C"].forEach(t => plantilla("reserva_completa", t));
    const alAzar = await reserva({ ok: true, reservados: ["1"], ocupados: [], mensaje: "F" }, {}, 0.99);
    assert.strictEqual(alAzar.texto, "C");
    assert.strictEqual(unica(alAzar.sombras).seleccion.azar, 0.99);
    coincide(alAzar.sombras[0]);
    escenario();
    const fija = plantilla("reserva_completa", "FIJA");
    plantilla("reserva_completa", "OTRA");
    seleccion("reserva_completa", { modo_seleccion: "fijo", plantilla_fija_id: fija.id });
    coincide(unica((await reserva({ ok: true, reservados: ["1"], ocupados: [], mensaje: "F" })).sombras));
    fija.habilitada = false;
    const resp = await reserva({ ok: true, reservados: ["1"], ocupados: [], mensaje: "RESPALDO" });
    assert.strictEqual(resp.texto, "RESPALDO");
    const s = unica(resp.sombras);
    coincide(s);
    assert.strictEqual(s.orquestador.fuente, "fijo");
});

prueba("O4-17 plantilla vacía elegida (semilla «Personalizada») → respaldo en ambos", async () => {
    escenario();
    plantilla("reserva_completa", "LLENA"); plantilla("reserva_completa", "");
    const r = await reserva({ ok: true, reservados: ["1"], ocupados: [], mensaje: "RESPALDO" }, {}, 0.99);
    assert.strictEqual(r.texto, "RESPALDO");
    coincide(unica(r.sombras));
});

// ===================================================== variables y formatos ===

prueba("O4-18 variables, modificadores, alias, opciones de mostrar/emojis y ceros iniciales → mismas variables y texto", async () => {
    escenario();
    plantilla("reserva_completa", "🎟️ [{{no_existe}}] {{cliente}} {{numeros_reservados}} {{loteria|upper}} {{tu_numero_tus_numeros|capitalize}}", { variables: { mostrar_nombre: false, emojis: false } });
    const { texto, sombras } = await reserva({ ok: true, reservados: ["00", "07"], ocupados: [], mensaje: "F" });
    assert.strictEqual(texto, "[]  ( 00 - 07 ) LOTERÍA DE MANIZALES Tus números");
    const s = unica(sombras);
    coincide(s);
    assert.strictEqual(s.variables.coinciden, true);
});

// ===================================================== aislamiento ===

prueba("O4-19 aislamiento: plantillas y configuración de otro cliente no cuentan en ninguno de los dos", async () => {
    escenario();
    plantilla("reserva_completa", "DE B", {}, B);
    seleccion("reserva_completa", { habilitada: false }, B);
    const { texto, sombras } = await reserva({ ok: true, reservados: ["1"], ocupados: [], mensaje: "RESPALDO A" });
    assert.strictEqual(texto, "RESPALDO A");
    coincide(unica(sombras));
});

prueba("O4-20 socket de OTRO cliente: el motor responde igual (como hoy); la sombra lo rechaza y lo registra como diferencia", async () => {
    escenario();
    const { texto, sombras } = await reserva({ ok: true, reservados: ["1"], ocupados: [], mensaje: "F" }, { sock: { context: { usuarioId: B } } });
    assert.strictEqual(texto, "F");
    const s = unica(sombras);
    assert.deepStrictEqual([s.coincide, s.motivo], [false, "error_orquestador:sesion_de_otro_cliente"]);
});

prueba("O4-21 sin cliente de sesión: el motor usa el respaldo; la sombra lo marca como no comparable", async () => {
    escenario();
    const { texto, sombras } = await reserva({ ok: true, reservados: ["1"], ocupados: [], mensaje: "RESPALDO" }, { session: { sessionId: "s" } });
    assert.strictEqual(texto, "RESPALDO");
    assert.deepStrictEqual([unica(sombras).coincide, sombras[0].motivo], [null, "no_comparable:sin_usuario_de_sesion"]);
});

// ===================================================== sin efectos ===

prueba("O4-22 sin efectos: un solo envío, misma cita y socket; ninguna escritura de la sombra; IA solo la del motor", async () => {
    escenario();
    plantilla("mis_numeros", "Tus {{numeros_totales_cliente}}");
    const antes = JSON.stringify(db.tablas);
    const ctx = ctxBase({ consulta: await silencio(() => resolverConsulta({ tipo: "mis_numeros", evento: EVENTO, usuario: USUARIO })) });
    db.reiniciarConsultas();
    await responder(ctx);
    assert.strictEqual(espias.enviados.length, 1);
    assert.strictEqual(espias.enviados[0].quoted, ctx.message);
    assert.strictEqual(espias.enviados[0].sock, ctx.sock);
    assert.deepStrictEqual(escrituras(), []);
    assert.strictEqual(JSON.stringify(db.tablas), antes);
    assert.strictEqual(espias.ia, 0);
});

prueba("O4-23 la sombra no tiene envíos, guardián, IA ni escrituras en su código", () => {
    const fuente = require("fs").readFileSync(r("bot/ai/sombraRespuestas.js"), "utf8");
    const creacion = fuente.slice(fuente.indexOf("crearOrquestador({"), fuente.indexOf("});", fuente.indexOf("crearOrquestador({")));
    assert.ok(!/envios\s*:/.test(creacion) && !/guardian\s*:/.test(creacion));
    assert.ok(!/require\([^)]*(baileys|aiService|contextBuilder|executionGuard|compartirTabla|puppeteer)/.test(fuente));
    assert.ok(!/actualizarRotacion|\.(insert|update|upsert|delete)\(/.test(fuente));
});

// ===================================================== diferencias y fallos ===

prueba("O4-24 diferencia real: las plantillas cambian entre la respuesta del motor y la sombra → candidatas_distintas", async () => {
    escenario();
    plantilla("reserva_completa", "VIEJA");
    espias.alEnviar = () => { plantilla("reserva_completa", "NUEVA"); };
    const { texto, sombras } = await reserva({ ok: true, reservados: ["1"], ocupados: [], mensaje: "F" });
    assert.strictEqual(texto, "VIEJA");
    assert.deepStrictEqual([unica(sombras).coincide, sombras[0].motivo], [false, "candidatas_distintas"]);
});

prueba("O4-25 fallo de lectura en la sombra → la respuesta real ya salió; la diferencia queda registrada", async () => {
    escenario();
    plantilla("reserva_completa", "HOLA");
    espias.alEnviar = () => db.forzarError("plantillas_mensaje");
    const { ok, texto, sombras } = await reserva({ ok: true, reservados: ["1"], ocupados: [], mensaje: "F" });
    assert.deepStrictEqual([ok, texto], [true, "HOLA"]);
    assert.strictEqual(unica(sombras).coincide, false);
});

prueba("O4-26 si el módulo de sombra entero falla, la respuesta y su resultado no cambian", async () => {
    escenario();
    plantilla("reserva_completa", "HOLA");
    const ruta = r("bot/ai/sombraRespuestas.js");
    const original = require.cache[ruta];
    inyectar(ruta, { compararRespuestaEnSombra: async () => { throw new Error("explotó (simulado)"); } });
    try {
        const { ok, texto, todo } = await reserva({ ok: true, reservados: ["1"], ocupados: [], mensaje: "F" });
        assert.deepStrictEqual([ok, texto], [true, "HOLA"]);
        assert.ok(todo.some(l => l.includes("comparación omitida") && l.includes("explotó")));
    } finally { if (original) require.cache[ruta] = original; else delete require.cache[ruta]; }
});

prueba("O4-27 fallo de WhatsApp en el motor → devuelve false como siempre; la sombra compara igual (fallo_envio)", async () => {
    escenario();
    plantilla("reserva_completa", "HOLA");
    espias.alEnviar = () => { throw new Error("rechazado"); };
    const { ok, sombras } = await reserva({ ok: true, reservados: ["1"], ocupados: [], mensaje: "F" });
    assert.strictEqual(ok, false);
    const s = unica(sombras);
    coincide(s);
    assert.strictEqual(s.actual.estado, "fallo_envio");
});

prueba("O4-28 «active» configurado = solo sombra; privacidad: sin JID, sin teléfonos y sin el nombre del cliente", async () => {
    escenario({ modo: "active" });
    plantilla("reserva_completa", "Hola {{cliente}}, paga al 3001234567");
    const { crudas, sombras } = await reserva({ ok: true, reservados: ["1"], ocupados: [], mensaje: "F" });
    assert.strictEqual(espias.enviados.length, 1);
    const s = unica(sombras);
    assert.deepStrictEqual([s.orquestador.estado, s.modoConfigurado, Boolean(s.aviso)], ["sombra", "active", true]);
    assert.ok(!crudas[0].includes("573001112233") && !crudas[0].includes("Carlos"), crudas[0]);
    assert.strictEqual(s.actual.vistaPrevia, "Hola ‹cliente›, paga al •••");
});

ejecutar("O4 · Respuestas a reservas y consultas en modo sombra").finally(() => { delete process.env.MENSAJES_ORQUESTADOR_RESPUESTA; });
