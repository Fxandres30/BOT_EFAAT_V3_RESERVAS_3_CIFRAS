// ==========================================================================
// FASE O0 — CARACTERIZACIÓN del motor 1: RESPUESTAS (reservas y consultas).
//
// Reales: responderResultado.js, configMensajes.js, seleccionarPlantilla.js,
// plantillaMensaje.js, gramatica.js, shared/variables, resolverConsulta.js,
// consultarMisNumeros.js, consultarNumero.js, consultarDisponibilidad.js,
// determinarEstadoPago.js. Simulados: Supabase (memoria, dos clientes), la
// redacción con IA (espía) y el envío por WhatsApp (espía).
//
//     node backend/tests/mensajes-o0/o0Respuestas.test.js
// ==========================================================================

"use strict";

const assert = require("assert");
const { r, inyectar, crearDb, silencio, conAzar } = require("./_comun");
const { prueba, riesgo, ejecutar } = require("../caracterizacion/_prueba");

const TABLA = "5k_15k_reservas_2_cifras";
const A = "tenant-A";
const B = "tenant-B";

let db = crearDb();
inyectar(r("lib/supabase.js"), { from: (t) => db.client.from(t) });

const espias = { ia: [], iaFalla: false, enviados: [] };

inyectar(r("bot/ai/aiService.js"), {
    suggestReply: async (ctx) => {
        espias.ia.push(ctx);
        if (espias.iaFalla) throw new Error("IA caída (simulado)");
        return { respuesta: "TEXTO REDACTADO POR IA" };
    }
});
inyectar(r("bot/ai/contextBuilder.js"), { construirContextoReserva: () => ({ simulado: true }) });
inyectar(r("shared/variables/variablesGlobalesRepo.js"), { obtenerVariablesActivas: async () => [] });
inyectar(r("services/baileys/send.js"), {
    sendMessage: async (args) => { espias.enviados.push(args); return { key: { id: "x" } }; },
    sendImage: async () => {},
    sendReaction: async () => {}
});

const { responderResultado } = require(r("bot/ai/responderResultado.js"));
const { resolverConsulta } = require(r("bot/funciones/consultas/resolverConsulta.js"));
const { calcularTipoPresentacion } = require(r("bot/ai/plantillaMensaje.js"));

// ----------------------------------------------------------------- datos ---

const EVENTO = {
    id: "ev-1", usuario_id: A, nombre_evento: "Lotería De Manizales", tabla: TABLA, cifras: 2,
    identidad_evento_real: "ident-1", hora_fin: "22:30", valor: 3000, activo: true, fecha_evento: null
};
const USUARIO = { id: "u-1", nombre: "Carlos" };
const SOCK = { simulado: "sock-A" };

let sec = 0;

function escenario() {
    db = crearDb({ plantillas_mensaje: [], configuracion_seleccion_mensajes: [], eventos_bot: [], [TABLA]: [] });
    espias.ia = []; espias.iaFalla = false; espias.enviados = [];
    // Cuadrícula de 100 números, todos libres.
    db.tablas[TABLA] = Array.from({ length: 100 }, (_, i) => ({ usuario_id: A, numero: String(i).padStart(2, "0"), estado: "libre", usuario_global_id: null }));
}

function plantilla(tipo, contenido, extra = {}, usuario = A) {
    const fila = { id: `p-${++sec}`, usuario_id: usuario, tipo_respuesta: tipo, nombre: `P${sec}`, estilo: "x", contenido, variables: {}, habilitada: true, orden: sec, ...extra };
    db.filas("plantillas_mensaje").push(fila);
    return fila;
}

function seleccion(tipo, extra = {}, usuario = A) {
    const fila = { id: `cfg-${++sec}`, usuario_id: usuario, tipo_respuesta: tipo, modo_seleccion: "aleatorio", plantilla_fija_id: null, rotacion_indice: 0, habilitada: true, ...extra };
    db.filas("configuracion_seleccion_mensajes").push(fila);
    return fila;
}

function marcar(numeros, estado, usuarioGlobal = USUARIO.id) {
    for (const n of numeros) Object.assign(db.tablas[TABLA].find(f => f.numero === n), { estado, usuario_global_id: usuarioGlobal });
}

function ctxBase(extra = {}) {
    return {
        sock: SOCK,
        session: { usuarioId: A, sessionId: "ses-A" },
        chat: { remoteJid: "g1@g.us", esGrupo: true },
        message: { key: { id: `M${++sec}`, remoteJid: "g1@g.us", fromMe: false } },
        usuario: USUARIO,
        evento: EVENTO,
        textoOriginal: "",
        ...extra
    };
}

async function responderReserva(reserva, extra = {}) {
    const ctx = ctxBase({ reserva, ...extra });
    const ok = await silencio(() => responderResultado(ctx));
    return { ok, texto: espias.enviados.at(-1)?.text, envio: espias.enviados.at(-1), ctx };
}

async function responderConsulta(intencion, extra = {}) {
    const consulta = await silencio(() => resolverConsulta({ evento: EVENTO, usuario: USUARIO, ...intencion }));
    const ctx = ctxBase({ consulta, ...extra });
    const ok = await silencio(() => responderResultado(ctx));
    return { ok, consulta, texto: espias.enviados.at(-1)?.text, tipo: calcularTipoPresentacion(ctx, consulta) };
}

const pedidas = () => db.consultas.filter(c => c.tabla === "plantillas_mensaje").map(c => c.filtros.find(f => f[1] === "tipo_respuesta")?.[2]);

// ============================================================ RESERVAS ===

prueba("R1 reserva completa sin plantillas → mensaje fijo de detectarReserva; nunca IA", async () => {
    escenario();
    const { texto } = await responderReserva({ ok: true, reservados: ["27"], ocupados: [], mensaje: "FIJO-RESERVA" });
    assert.strictEqual(texto, "FIJO-RESERVA");
    assert.strictEqual(espias.ia.length, 0);
});

prueba("R2 reserva completa con plantilla → variables reales, singular y plural según la cantidad", async () => {
    escenario();
    plantilla("reserva_completa", "{{cliente}}: {{tu_numero_tus_numeros}} {{numeros_reservados}} {{quedo_quedaron}} {{reservado_reservados}}");
    const uno = await responderReserva({ ok: true, reservados: ["27"], ocupados: [], mensaje: "F" });
    const dos = await responderReserva({ ok: true, reservados: ["27", "45"], ocupados: [], mensaje: "F" });
    assert.strictEqual(uno.texto, "Carlos: tu número ( 27 ) quedó reservado");
    assert.strictEqual(dos.texto, "Carlos: tus números ( 27 - 45 ) quedaron reservados");
});

prueba("R3 reserva parcial → tipo reserva_parcial; el anexo «textoAdicional» va después de la plantilla", async () => {
    escenario();
    plantilla("reserva_parcial", "Reservados {{numeros_reservados}} · ocupados {{numeros_ocupados}}");
    const { texto } = await responderReserva({ ok: true, reservados: ["27"], ocupados: ["45"], mensaje: "F", textoAdicional: "Ya es tuyo: ( 12 )" });
    assert.deepStrictEqual(pedidas(), ["reserva_parcial"]);
    assert.strictEqual(texto, "Reservados ( 27 ) · ocupados ( 45 )\n\nYa es tuyo: ( 12 )");
});

prueba("R4 ok:false → numero_ocupado (1 ocupado) o todos_ocupados (varios)", async () => {
    escenario();
    const ctx = ctxBase({ reserva: {} });
    assert.strictEqual(calcularTipoPresentacion(ctx, { ok: false, ocupados: ["27"] }), "numero_ocupado");
    assert.strictEqual(calcularTipoPresentacion(ctx, { ok: false, ocupados: ["27", "45"] }), "todos_ocupados");
    assert.strictEqual(calcularTipoPresentacion(ctx, { ok: true, reservados: ["1"], bloqueados: ["2"] }), "reserva_parcial");
});

prueba("R5 sin tipo (ok:false sin ocupados, o error técnico) → mensaje fijo, sin interruptor ni plantillas", async () => {
    escenario();
    seleccion("numero_ocupado", { habilitada: false });
    const a = await responderReserva({ ok: false, ocupados: [], mensaje: "YA-ERAN-TUYOS" });
    const b = await responderReserva({ ok: false, errorTecnico: true, mensaje: "❌ No fue posible procesar tu reserva. Intenta nuevamente." });
    assert.strictEqual(a.texto, "YA-ERAN-TUYOS");
    assert.strictEqual(b.texto, "❌ No fue posible procesar tu reserva. Intenta nuevamente.");
    assert.strictEqual(pedidas().length, 0);
});

prueba("R6 interruptor del tipo apagado → no se envía nada y devuelve false", async () => {
    escenario();
    seleccion("reserva_completa", { habilitada: false });
    plantilla("reserva_completa", "NO DEBE SALIR");
    const { ok } = await responderReserva({ ok: true, reservados: ["27"], ocupados: [], mensaje: "F" });
    assert.strictEqual(ok, false);
    assert.strictEqual(espias.enviados.length, 0);
});

prueba("R7 sin fila de configuración → el tipo cuenta como ACTIVADO (valor seguro por defecto)", async () => {
    escenario();
    const { ok } = await responderReserva({ ok: true, reservados: ["27"], ocupados: [], mensaje: "F" });
    assert.strictEqual(ok, true);
});

// =========================================================== SELECCIÓN ===

prueba("S1 aleatorio → índice floor(azar × n) entre las habilitadas, en orden de «orden»", async () => {
    escenario();
    ["A", "B", "C"].forEach(t => plantilla("reserva_completa", t));
    plantilla("reserva_completa", "INACTIVA", { habilitada: false });
    const r0 = await conAzar([0.0], () => responderReserva({ ok: true, reservados: ["1"], ocupados: [], mensaje: "F" }));
    const r2 = await conAzar([0.99], () => responderReserva({ ok: true, reservados: ["1"], ocupados: [], mensaje: "F" }));
    assert.strictEqual(r0.texto, "A");
    assert.strictEqual(r2.texto, "C");
});

prueba("S2 rotación → usa rotacion_indice, lo avanza y lo guarda; da la vuelta", async () => {
    escenario();
    ["A", "B", "C"].forEach(t => plantilla("reserva_completa", t));
    const cfg = seleccion("reserva_completa", { modo_seleccion: "rotacion", rotacion_indice: 1 });
    const salidas = [];
    for (let i = 0; i < 4; i++) salidas.push((await responderReserva({ ok: true, reservados: ["1"], ocupados: [], mensaje: "F" })).texto);
    assert.deepStrictEqual(salidas, ["B", "C", "A", "B"]);
    assert.strictEqual(cfg.rotacion_indice, 2);
});

prueba("S3 fijo → siempre la plantilla fija; fija deshabilitada o borrada → respaldo (nunca otra plantilla)", async () => {
    escenario();
    plantilla("reserva_completa", "OTRA");
    const fija = plantilla("reserva_completa", "FIJA");
    seleccion("reserva_completa", { modo_seleccion: "fijo", plantilla_fija_id: fija.id });
    assert.strictEqual((await responderReserva({ ok: true, reservados: ["1"], ocupados: [], mensaje: "F" })).texto, "FIJA");
    fija.habilitada = false;
    assert.strictEqual((await responderReserva({ ok: true, reservados: ["1"], ocupados: [], mensaje: "RESPALDO" })).texto, "RESPALDO");
});

prueba("S4 plantilla vacía elegida al azar → se usa el respaldo (inconsistencia de las semillas «Personalizada»)", async () => {
    escenario();
    plantilla("reserva_completa", "LLENA");
    plantilla("reserva_completa", "");
    const vacia = await conAzar([0.99], () => responderReserva({ ok: true, reservados: ["1"], ocupados: [], mensaje: "RESPALDO" }));
    assert.strictEqual(vacia.texto, "RESPALDO");
    riesgo("La semilla «Personalizada» (contenido vacío) queda ACTIVA: si el azar la elige, la respuesta cae al mensaje fijo (o a la IA en tipos que la usan).");
});

prueba("S5 opciones de la plantilla: mostrar_*=false vacía la variable; emojis=false quita los emojis escritos", async () => {
    escenario();
    plantilla("reserva_completa", "🎟️ {{cliente}} {{numeros_reservados}} 🍀", { variables: { mostrar_nombre: false, emojis: false } });
    const { texto } = await responderReserva({ ok: true, reservados: ["27"], ocupados: [], mensaje: "F" });
    assert.strictEqual(texto, " ( 27 )");
});

prueba("S6 modificadores (|capitalize, |upper) y alias del catálogo (loteria → evento)", async () => {
    escenario();
    plantilla("reserva_completa", "{{tu_numero_tus_numeros|capitalize}} · {{loteria|upper}}");
    const { texto } = await responderReserva({ ok: true, reservados: ["27"], ocupados: [], mensaje: "F" });
    assert.strictEqual(texto, "Tu número · LOTERÍA DE MANIZALES");
});

prueba("S7 variable desconocida → se sustituye por vacío (en respuestas nunca bloquea el envío)", async () => {
    escenario();
    plantilla("reserva_completa", "[{{no_existe}}] {{numeros_reservados}}");
    const { texto } = await responderReserva({ ok: true, reservados: ["27"], ocupados: [], mensaje: "F" });
    assert.strictEqual(texto, "[] ( 27 )");
});

// ============================================================ CONSULTAS ===

prueba("C1 mis números con pagados y pendientes → plantilla mis_numeros con listas reales", async () => {
    escenario();
    marcar(["27"], "pagado"); marcar(["01", "48"], "reservado");
    plantilla("mis_numeros", "Todos {{numeros_totales_cliente}} | pagados {{numeros_pagados}} | pendientes {{numeros_pendientes}}");
    const { texto, tipo } = await responderConsulta({ tipo: "mis_numeros" });
    assert.strictEqual(tipo, "mis_numeros");
    assert.strictEqual(texto, "Todos ( 01 - 27 - 48 ) | pagados ( 27 ) | pendientes ( 01 - 48 )");
});

prueba("C2 mis números SIN números y con plantilla → la plantilla sale con «ninguno»", async () => {
    escenario();
    plantilla("mis_numeros", "🎟️ {{tu_numero_tus_numeros|capitalize}}: {{numeros_totales_cliente}}\n✅ Pagados: {{numeros_pagados}}\n⏳ Por pagar: {{numeros_pendientes}}");
    const { texto } = await responderConsulta({ tipo: "mis_numeros" });
    assert.strictEqual(texto, "🎟️ Tus números: ninguno\n✅ Pagados: ninguno\n⏳ Por pagar: ninguno");
    riesgo("«Mis números» sin números usa igual sus plantillas: «Tus números: ninguno / Pagados: ninguno / Por pagar: ninguno».");
});

prueba("C3 mis números sin plantillas → mensaje fijo; los tipos de estado nunca usan IA", async () => {
    escenario();
    const vacio = await responderConsulta({ tipo: "mis_numeros" });
    marcar(["27"], "pagado"); marcar(["45"], "reservado");
    const mixto = await responderConsulta({ tipo: "mis_numeros" });
    assert.strictEqual(vacio.texto, "No tienes números en este sorteo.");
    assert.strictEqual(mixto.texto, "Tus números son: ( 27 - 45 )\n✅ Pagado: ( 27 )\n⏳ Pendiente de pago: ( 45 )");
    assert.strictEqual(espias.ia.length, 0);
});

prueba("C4 consulta de pago → 4 tipos según el estado real (sin_pago, pago_parcial, pago_completo, sin_saldo)", async () => {
    escenario();
    const tipos = [];
    tipos.push((await responderConsulta({ tipo: "consulta_pago", modo: "resumen", bucket: "pendiente" })).tipo);
    marcar(["10"], "reservado");
    tipos.push((await responderConsulta({ tipo: "consulta_pago", modo: "resumen", bucket: "pendiente" })).tipo);
    marcar(["11"], "pagado");
    tipos.push((await responderConsulta({ tipo: "consulta_pago", modo: "resumen", bucket: "pendiente" })).tipo);
    marcar(["10"], "pagado");
    tipos.push((await responderConsulta({ tipo: "consulta_pago", modo: "resumen", bucket: "pendiente" })).tipo);
    assert.deepStrictEqual(tipos, ["consulta_pago_sin_saldo", "consulta_pago_sin_pago", "consulta_pago_pago_parcial", "consulta_pago_pago_completo"]);
});

prueba("C5 sorteo sin precio → se descartan las plantillas de pago con montos; nunca «$0»", async () => {
    escenario();
    marcar(["10"], "reservado");
    plantilla("consulta_pago_sin_pago", "Debes {{monto_pendiente}}");
    plantilla("consulta_pago_sin_pago", "Te falta: {{numeros_pendientes}}");
    const evSinPrecio = { ...EVENTO, valor: 0 };
    const consulta = await silencio(() => resolverConsulta({ tipo: "consulta_pago", modo: "resumen", bucket: "pendiente", evento: evSinPrecio, usuario: USUARIO }));
    await conAzar([0.0], () => silencio(() => responderResultado(ctxBase({ consulta, evento: evSinPrecio }))));
    assert.strictEqual(espias.enviados.at(-1).text, "Te falta: ( 10 )");
});

prueba("C6 preguntas puntuales de pago (lista/cantidad/monto) → solo mensaje fijo; no piden plantillas", async () => {
    escenario();
    marcar(["10"], "reservado"); marcar(["11"], "pagado");
    plantilla("consulta_pago_pago_parcial", "NO DEBE SALIR");
    db.reiniciarConsultas();
    const lista = await responderConsulta({ tipo: "consulta_pago", modo: "lista", bucket: "pagado" });
    const monto = await responderConsulta({ tipo: "consulta_pago", modo: "monto", bucket: "pagado" });
    assert.strictEqual(lista.texto, "✅ Números pagados: ( 11 ).");
    assert.strictEqual(monto.texto, "✅ Has pagado: $3.000.");
    assert.strictEqual(pedidas().length, 0);
});

prueba("C7 disponibilidad: agotado → plantillas de agotado; fallo de lectura → error técnico fijo", async () => {
    escenario();
    db.tablas[TABLA].forEach(f => { f.estado = "reservado"; });
    plantilla("disponibilidad_agotada", "🚫 AGOTADO {{evento}}");
    const agotado = await responderConsulta({ tipo: "disponibilidad" });
    assert.strictEqual(agotado.tipo, "disponibilidad_agotada");
    assert.strictEqual(agotado.texto, "🚫 AGOTADO Lotería De Manizales");
    db.forzarError(TABLA);
    const fallo = await responderConsulta({ tipo: "disponibilidad" });
    assert.strictEqual(fallo.texto, "❌ No pude consultar los números en este momento. Intenta nuevamente en unos minutos.");
});

prueba("C8 información del sorteo sin plantillas → redacción con IA; si la IA falla → mensaje fijo", async () => {
    escenario();
    const conIa = await responderConsulta({ tipo: "info_evento" });
    assert.strictEqual(conIa.texto, "TEXTO REDACTADO POR IA");
    espias.iaFalla = true;
    const sinIa = await responderConsulta({ tipo: "info_evento" });
    assert.ok(/^Este sorteo es: Lotería De Manizales/.test(sinIa.texto), sinIa.texto);
});

prueba("C9 estado de un número: la plantilla NO dice el estado; estados raros (bloqueado) → solo mensaje fijo", async () => {
    escenario();
    plantilla("numero_especifico", "Revisando {{numeros_solicitados}} para ti, {{cliente}}.");
    marcar(["23"], "reservado", "otra-persona");
    const ajeno = await responderConsulta({ tipo: "numero_especifico", numeros: ["23"] });
    assert.strictEqual(ajeno.consulta.mensaje, "El número ( 23 ) está reservado por otra persona.");
    assert.strictEqual(ajeno.texto, "Revisando ( 23 ) para ti, Carlos.");
    riesgo("«Estado de un número» con plantilla activa no informa el estado real (libre, tuyo, de otro): las plantillas no tienen una variable de estado.");
    db.tablas[TABLA].find(f => f.numero === "24").estado = "bloqueado";
    const bloqueado = await responderConsulta({ tipo: "numero_especifico", numeros: ["24"] });
    assert.strictEqual(bloqueado.texto, "El número ( 24 ) está bloqueado y no se puede reservar por ahora.");
});

prueba("C10 sorteo no vigente → «No hay un sorteo activo…» fijo, aunque haya plantillas", async () => {
    escenario();
    plantilla("mis_numeros", "NO DEBE SALIR");
    const cerrado = { ...EVENTO, activo: false };
    const consulta = await silencio(() => resolverConsulta({ tipo: "mis_numeros", evento: cerrado, usuario: USUARIO }));
    await silencio(() => responderResultado(ctxBase({ consulta, evento: cerrado })));
    assert.strictEqual(espias.enviados.at(-1).text, "No hay un sorteo activo en este grupo en este momento.");
});

prueba("C11 «mis reservas» → usa las plantillas de mis_numeros", async () => {
    escenario();
    plantilla("mis_numeros", "MIS NUMEROS {{numeros_totales_cliente}}");
    const { texto, tipo } = await responderConsulta({ tipo: "mis_reservas" });
    assert.strictEqual(tipo, "mis_numeros");
    assert.strictEqual(texto, "MIS NUMEROS ninguno");
});

// ========================================================== AISLAMIENTO ===

prueba("A1 nunca usa plantillas ni configuración de otro cliente para el mismo tipo", async () => {
    escenario();
    plantilla("reserva_completa", "DE B", {}, B);
    seleccion("reserva_completa", { habilitada: false }, B);
    const { texto, ok } = await responderReserva({ ok: true, reservados: ["1"], ocupados: [], mensaje: "RESPALDO A" });
    assert.strictEqual(ok, true);
    assert.strictEqual(texto, "RESPALDO A");
});

prueba("A2 envía con el socket de la sesión, al chat de origen y citando el mensaje del cliente", async () => {
    escenario();
    const { envio, ctx } = await responderReserva({ ok: true, reservados: ["1"], ocupados: [], mensaje: "F" });
    assert.strictEqual(envio.sock, SOCK);
    assert.strictEqual(envio.jid, "g1@g.us");
    assert.strictEqual(envio.quoted, ctx.message);
});

prueba("A3 sin usuario de sesión → no se consulta ningún interruptor ni plantilla (solo respaldo/IA)", async () => {
    escenario();
    plantilla("reserva_completa", "PLANTILLA");
    const { texto } = await responderReserva({ ok: true, reservados: ["1"], ocupados: [], mensaje: "RESPALDO" }, { session: { sessionId: "s" } });
    assert.strictEqual(texto, "RESPALDO");
});

ejecutar("O0 · Motor 1: respuestas (reservas y consultas)");
