// ==========================================================================
// shared/mensajes/modos.js — modo del ORQUESTADOR por ORIGEN de mensajes.
//
//   off     el orquestador no hace nada: el motor actual sigue enviando.
//   shadow  calcula qué habría enviado y lo compara, SIN ningún efecto.
//   active  el orquestador envía (el motor actual deja de llamar a su envío).
//
// Por defecto TODO está en off. En O1 nada lee estas variables: el núcleo
// todavía no está conectado a ningún motor.
//
// Variable por origen: MENSAJES_ORQUESTADOR_<ORIGEN> (p. ej.
// MENSAJES_ORQUESTADOR_INICIO_DIA=shadow). Un valor desconocido = off.
// ==========================================================================

"use strict";

const MODOS = Object.freeze({ OFF: "off", SHADOW: "shadow", ACTIVE: "active" });
const VALIDOS = new Set(Object.values(MODOS));

function nombreVariable(origen) {
    return `MENSAJES_ORQUESTADOR_${String(origen || "").toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
}

// -> "off" | "shadow" | "active" (nunca lanza; cualquier duda = off)
function resolverModo(origen, entorno = process.env) {
    if (!origen) return MODOS.OFF;
    const valor = String(entorno?.[nombreVariable(origen)] ?? "").trim().toLowerCase();
    return VALIDOS.has(valor) ? valor : MODOS.OFF;
}

module.exports = { MODOS, resolverModo, nombreVariable };
