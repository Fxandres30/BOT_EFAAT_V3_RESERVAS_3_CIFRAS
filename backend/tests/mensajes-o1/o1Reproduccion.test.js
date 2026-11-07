// ==========================================================================
// FASE O1 — el orquestador + las funciones de FORMATO REALES de cada motor
// reproducen los textos fijados en O0, incluidas las inconsistencias
// documentadas (no se corrigen todavía).
//
// Reales (puras): bot/ai/plantillaMensaje.aplicarPlantilla,
// automation/variableResolver.resolverVariables, shared/variables
// (resolverTexto + construirContextoGlobal), sorteos/mensajes.
// mensajeRecordatorio. Son las piezas que usarán los adaptadores en O2; aquí
// se montan adaptadores de PRUEBA, no los reales. Ningún motor se conecta.
//
//     node backend/tests/mensajes-o1/o1Reproduccion.test.js
// ==========================================================================

"use strict";

const assert = require("assert");
const path = require("path");
const { prueba, riesgo, ejecutar } = require("../caracterizacion/_prueba");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);

// Ninguna de estas funciones debería tocar Supabase; si alguna lo hiciera,
// fallaría en voz alta.
require.cache[r("lib/supabase.js")] = { id: r("lib/supabase.js"), filename: r("lib/supabase.js"), loaded: true, exports: { from() { throw new Error("Supabase no permitido en O1"); } } };

const { crearOrquestador, crearGuardianMemoria } = require(r("shared/mensajes"));
const { aplicarPlantilla } = require(r("bot/ai/plantillaMensaje.js"));
const { resolverVariables } = require(r("automation/variableResolver.js"));
const { resolverTexto } = require(r("shared/variables/resolverVariables.js"));
const { construirContextoGlobal } = require(r("shared/variables/contextoVariables.js"));
const { mensajeRecordatorio } = require(r("sorteos/mensajes.js"));

const A = "cliente-A";
const sock = { context: { usuarioId: A } };
const base = (extra) => ({ usuarioId: A, sesion: { sock }, destino: { jid: "g1@g.us" }, ...extra });

// ---------------------------------------- adaptadores de PRUEBA (no los reales)

function adaptadorRespuestas(plantillas, variables) {
    return {
        candidatas: async () => plantillas,
        preferencias: async () => ({ modo_seleccion: "aleatorio" }),
        variables: async () => variables,
        renderizar: (contenido, vars, _s, plantilla) => aplicarPlantilla(contenido, vars, plantilla?.variables || {})
    };
}

function adaptadorAutomatizacion(mensajes, variables) {
    return {
        bloquearSiFaltan: true,
        candidatas: async () => mensajes,
        variables: async () => variables,
        renderizar: (contenido, vars) => { const x = resolverVariables(contenido, vars); return { texto: x.texto, faltantes: x.faltantes }; }
    };
}

const adaptadorInicioDia = (plantillas) => ({
    candidatas: async () => plantillas,
    preferencias: async () => ({ modo_seleccion: "fijo", plantilla_fija_id: plantillas[0]?.id }),
    renderizar: (contenido) => resolverTexto(contenido, construirContextoGlobal({}))
});

const CONFIG_SORTEO = { nombre: "Lotería De Manizales", hora_fin: "22:30", hora_cierre: "22:00", valor: 3000, premios: [], mensajes: {} };
const adaptadorSorteo = { renderizar: (contenido) => mensajeRecordatorio(CONFIG_SORTEO, { texto: contenido }, [], {}).texto };

const shadow = (adaptadores, solicitud) => crearOrquestador({ adaptadores, modo: () => "shadow", aleatorio: () => 0 }).procesar(solicitud);

// ============================================================ RESPUESTAS ===

const VARS_RESERVA = { cliente: "Carlos", numeros_reservados: "( 27 )", evento: "Lotería De Manizales", tu_numero_tus_numeros: "tu número" };

prueba("RP1 S5–S7: variable desconocida vacía, modificadores, alias y «emojis desactivados»", async () => {
    const plantillas = [{ id: "p", usuario_id: A, contenido: "🎟️ [{{no_existe}}] {{tu_numero_tus_numeros|capitalize}} {{loteria|upper}}", variables: { emojis: false } }];
    const res = await shadow({ respuesta: adaptadorRespuestas(plantillas, VARS_RESERVA) }, base({ origen: "respuesta", tipo: "reserva_completa", textoRespaldo: "F" }));
    assert.strictEqual(res.texto, "[] Tu número LOTERÍA DE MANIZALES");
});

prueba("RP2 S4: la plantilla vacía elegida → aplicarPlantilla da null → respaldo fijo", async () => {
    const res = await shadow({ respuesta: adaptadorRespuestas([{ id: "vacia", usuario_id: A, contenido: "" }], VARS_RESERVA) }, base({ origen: "respuesta", tipo: "reserva_completa", textoRespaldo: "RESPALDO" }));
    assert.deepStrictEqual([res.texto, res.fuente], ["RESPALDO", "fijo"]);
    riesgo("Reproducido a propósito (S4): plantilla «Personalizada» vacía → respaldo.");
});

prueba("RP3 C2: «ninguno» en mis números sin números (la plantilla se usa igual)", async () => {
    const plantillas = [{ id: "p", usuario_id: A, contenido: "🎟️ {{tu_numero_tus_numeros|capitalize}}: {{numeros_totales_cliente}}\n✅ Pagados: {{numeros_pagados}}" }];
    const res = await shadow({ respuesta: adaptadorRespuestas(plantillas, { tu_numero_tus_numeros: "tus números", numeros_totales_cliente: "ninguno", numeros_pagados: "ninguno" }) }, base({ origen: "respuesta", tipo: "mis_numeros", textoRespaldo: "F" }));
    assert.strictEqual(res.texto, "🎟️ Tus números: ninguno\n✅ Pagados: ninguno");
});

// ======================================================== AUTOMATIZACIÓN ===

const VARS_EVENTO = { nombre_evento: "Sinuano Día", evento: "Sinuano Día", hora_cierre: "14:26", valor: 1500, disponibles: 97 };

prueba("RP4 AU5: valores crudos (14:26, 1500) tal como hoy", async () => {
    const res = await shadow({ automatizacion: adaptadorAutomatizacion([{ id: "m", contenido: "{nombre_evento} cierra {hora_cierre} · {valor}" }], VARS_EVENTO) }, base({ origen: "automatizacion", tipo: "REMINDER_MESSAGE", claveEnvioUnico: "k" }));
    assert.strictEqual(res.texto, "Sinuano Día cierra 14:26 · 1500");
});

prueba("RP5 AU6: variable faltante → no se envía ni se consume la clave (en active)", async () => {
    const guardian = crearGuardianMemoria();
    const envios = { sendMessage: async () => { throw new Error("no debería enviar"); } };
    const orq = crearOrquestador({ adaptadores: { automatizacion: adaptadorAutomatizacion([{ id: "m", contenido: "Quedan {disponibles} — {inventada}" }], VARS_EVENTO) }, envios, guardian, modo: () => "active", aleatorio: () => 0 });
    const res = await orq.procesar(base({ origen: "automatizacion", tipo: "REMINDER_MESSAGE", claveEnvioUnico: "k" }));
    assert.deepStrictEqual([res.estado, res.motivo, res.faltantes, guardian.acciones.size], ["omitido", "variable_faltante", ["inventada"], 0]);
});

prueba("RP6 AU7: {{evento|upper}} sale literal, con llaves (reproducido, no corregido)", async () => {
    const res = await shadow({ automatizacion: adaptadorAutomatizacion([{ id: "m", contenido: "Hoy {{evento|upper}}" }], VARS_EVENTO) }, base({ origen: "automatizacion", tipo: "OPEN_MESSAGE", claveEnvioUnico: "k" }));
    assert.deepStrictEqual([res.estado, res.texto], ["sombra", "Hoy {{evento|upper}}"]);
});

// ========================================================= INICIO DEL DÍA ===

prueba("RP7 ID4–ID5: ignora el modo fijo (azar simple) y deja líneas vacías sin sorteo en contexto", async () => {
    const plantillas = [{ id: "a", usuario_id: A, contenido: "A" }, { id: "b", usuario_id: A, contenido: "☀️ Buenos días\n🎯 {{nombre_evento}}\n🏆 {{premio}}" }];
    const orq = crearOrquestador({ adaptadores: { inicio_dia: adaptadorInicioDia(plantillas) }, modo: () => "shadow", aleatorio: () => 0.99 });
    const res = await orq.procesar(base({ origen: "inicio_dia", tipo: "inicio_dia", claveEnvioUnico: "g1@g.us:DAILY_START_MESSAGE:2026-11-09" }));
    assert.deepStrictEqual([res.plantillaId, res.texto], ["b", "☀️ Buenos días\n🎯 \n🏆 "]);
});

// =============================================================== SORTEOS ===

prueba("RP8 SA1/SA8: la copia del sorteo con su formato (12 h, pesos) y {{nombre|upper}} literal", async () => {
    const res = await shadow({ sorteo: adaptadorSorteo }, base({ origen: "sorteo", tipo: "sorteo_recordatorio", textoAprobado: "⏰ {{nombre}} cierra {{hora_cierre}} · {{valor}} · {{nombre|upper}}", claveEnvioUnico: "k" }));
    assert.deepStrictEqual([res.fuente, res.texto], ["copia", "⏰ Lotería De Manizales cierra 10:00 PM · $3.000 · {{nombre|upper}}"]);
});

ejecutar("O1 · Reproducción de los textos de O0 con el orquestador");
