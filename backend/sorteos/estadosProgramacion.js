// ==========================================================================
// sorteos/estadosProgramacion.js: FUENTE ÚNICA de los conjuntos de estados
// de una programación (sorteos_programados.estado) que deciden reglas
// (F1-B, 06/11/2026).
//
// Antes había dos constantes con el MISMO nombre, ESTADOS_SIN_PUBLICAR, y
// distinto significado (administracion.js y reservasAnticipadas.js), las dos
// usadas dentro de administracion.js, y ESTADOS_EDITABLES estaba copiada en
// administracion.js, servicio.js y escrita a mano en gestionEventos.js. Los
// valores no cambian: solo el nombre deja claro qué pregunta responde cada
// lista.
//
// Pura: sin Supabase. No se valida aquí el estado de eventos_bot (eso es
// shared/eventos/estadosGestion.js).
// ==========================================================================

"use strict";

// ¿Se puede editar o cancelar? Solo lo que todavía no empezó a publicarse.
const ESTADOS_EDITABLES = Object.freeze(["borrador", "programado"]);

// ¿NUNCA llegó a publicarse? (eliminar sin actividad). «cancelado» entra
// porque solo se cancela desde ESTADOS_EDITABLES.
const ESTADOS_NUNCA_PUBLICADOS = Object.freeze(["borrador", "programado", "cancelado"]);

// ¿Todavía PUEDE publicarse? Sus reservas anticipadas no tienen un sorteo
// activo que las proteja (reservasAnticipadas.js). Espejo en el panel:
// frontend/services/tablas/impactoReinicio.ts (misma lista, comprobado por
// tests/sorteos/estadosProgramacion.test.js).
const ESTADOS_PENDIENTES_DE_PUBLICAR = Object.freeze(["borrador", "programado", "publicando", "fallido"]);

module.exports = { ESTADOS_EDITABLES, ESTADOS_NUNCA_PUBLICADOS, ESTADOS_PENDIENTES_DE_PUBLICAR };
