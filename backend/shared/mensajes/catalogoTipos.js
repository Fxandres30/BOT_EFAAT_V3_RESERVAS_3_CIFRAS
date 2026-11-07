// ==========================================================================
// shared/mensajes/catalogoTipos.js — CATÁLOGO ÚNICO de tipos de mensaje.
//
// Lo usarán el orquestador y, más adelante, el Centro de mensajes. Cada tipo
// declara CÓMO se procesa hoy en su motor (O0), para que el orquestador lo
// reproduzca igual. No decide negocio: cuándo y a quién se envía lo sigue
// decidiendo cada motor.
//
// Campos:
//   id          identificador real (tipo_respuesta, tipo de automation_messages…)
//   origen      respuesta | automatizacion | inicio_dia | sorteo | compartir | reaccion | sistema
//   categoria   agrupación visible (Reservas, Pagos, Apertura…)
//   canal       texto | imagen | reaccion
//   seleccion   preferencias          aleatorio / rotación / fijo (configuracion_seleccion_mensajes)
//               aleatorio_sin_repetir azar sin repetir el último usado (automatización)
//               aleatorio             azar simple (Inicio del día)
//               copia                 texto aprobado guardado (sorteos, anuncio)
//               ninguna               texto fijo o emoji
//   envioUnico  obligatorio | ninguno  (obligatorio = sin clave no se envía)
//   respaldo    fijo | fijo_o_ia | no_enviar | ninguno
//   aliasDe     el tipo cuyas plantillas e interruptor usa (mis_reservas → mis_numeros)
//   soportado   false = EFAAT nunca lo envía hoy (tipos «Futuro»)
//   motorActual archivo que lo genera hoy (verificado en las pruebas)
// ==========================================================================

"use strict";

const ORIGENES = Object.freeze(["respuesta", "automatizacion", "inicio_dia", "sorteo", "compartir", "reaccion", "sistema"]);
const CANALES = Object.freeze(["texto", "imagen", "reaccion"]);
const SELECCIONES = Object.freeze(["preferencias", "aleatorio_sin_repetir", "aleatorio", "copia", "ninguna"]);
const ENVIO_UNICO = Object.freeze(["obligatorio", "ninguno"]);
const RESPALDOS = Object.freeze(["fijo", "fijo_o_ia", "no_enviar", "ninguno"]);

const RESPUESTAS = "backend/bot/ai/responderResultado.js";
const AUTOMATIZACION = "backend/automation/engine.js";
const SCHEDULER = "backend/automation/scheduler.js";
const PUBLICADOR = "backend/sorteos/publicador.js";
const COMPARTIR = "backend/services/compartirTabla.js";
const REACCION = "backend/bot/funciones/reservas/reaccionReserva.js";
const CONSULTAS = "backend/bot/funciones/consultas/resolverConsulta.js";
const RESERVAS = "backend/bot/funciones/reservas/detectarReserva.js";

function respuesta(id, categoria, nombre, respaldo = "fijo", extra = {}) {
    return { id, origen: "respuesta", categoria, nombre, canal: "texto", seleccion: "preferencias", envioUnico: "ninguno", respaldo, soportado: true, motorActual: RESPUESTAS, ...extra };
}

function automatizacion(id, categoria, nombre) {
    return { id, origen: "automatizacion", categoria, nombre, canal: "texto", seleccion: "aleatorio_sin_repetir", envioUnico: "obligatorio", respaldo: "no_enviar", soportado: true, motorActual: AUTOMATIZACION };
}

function sistema(id, nombre, motorActual) {
    return { id, origen: "sistema", categoria: "Sistema", nombre, canal: "texto", seleccion: "ninguna", envioUnico: "ninguno", respaldo: "ninguno", soportado: true, motorActual };
}

const TIPOS = Object.freeze([

    // ------------------------------------------------ respuestas: reservas
    respuesta("reserva_completa", "Reservas", "Reserva completada"),
    respuesta("reserva_parcial", "Reservas", "Reserva parcial"),
    respuesta("numero_ocupado", "Reservas", "Número ocupado"),
    respuesta("todos_ocupados", "Reservas", "Todos los números ocupados"),

    // ------------------------------------------- respuestas: números y pagos
    respuesta("mis_numeros", "Números", "Mis números"),
    respuesta("mis_reservas", "Números", "Mis reservas (usa «Mis números»)", "fijo", { aliasDe: "mis_numeros" }),
    respuesta("consulta_pago_sin_pago", "Pagos", "Estado de pago — sin pagos"),
    respuesta("consulta_pago_pago_parcial", "Pagos", "Estado de pago — pago parcial"),
    respuesta("consulta_pago_pago_completo", "Pagos", "Estado de pago — pago completo"),
    respuesta("consulta_pago_sin_saldo", "Pagos", "Estado de pago — sin reservas activas"),

    // ------------------------------------------------- respuestas: consultas
    respuesta("cantidad_reservas", "Consultas", "Cantidad de reservas"),
    respuesta("numero_especifico", "Consultas", "Estado de un número"),
    respuesta("info_evento", "Consultas", "Información del sorteo", "fijo_o_ia"),
    respuesta("multiple", "Consultas", "Consulta combinada"),
    respuesta("disponibilidad", "Disponibilidad", "Números disponibles"),
    respuesta("disponibilidad_agotada", "Disponibilidad", "Sorteo agotado"),

    // Respuesta SIN tipo de presentación (calcularTipoPresentacion = null:
    // error técnico, reserva sin nada ocupado que informar…): solo el
    // mensaje fijo del motor, sin interruptor ni plantillas (FASE O4).
    respuesta("respuesta_fija", "Sistema", "Respuesta con el mensaje fijo del motor", "ninguno", { seleccion: "ninguna" }),

    // ------------------------------------- respuestas que EFAAT nunca envía
    ...["mensaje_no_entendido", "numero_invalido", "evento_no_disponible", "solicitud_ambigua", "otro_determinista"]
        .map(id => respuesta(id, "Futuro", id, "fijo", { soportado: false })),

    // ------------------------------------------------------- automatización
    automatizacion("OPEN_MESSAGE", "Apertura", "Mensaje de apertura"),
    automatizacion("REMINDER_MESSAGE", "Recordatorios", "Recordatorio"),
    automatizacion("UPDATE_MESSAGE", "Actualizaciones", "Actualización"),
    automatizacion("CLOSE_MESSAGE", "Cierres", "Mensaje de cierre"),

    // -------------------------------------------------------- inicio del día
    { id: "inicio_dia", origen: "inicio_dia", categoria: "Inicio del día", nombre: "Inicio del día", canal: "texto", seleccion: "aleatorio", envioUnico: "obligatorio", respaldo: "no_enviar", soportado: true, motorActual: SCHEDULER },

    // --------------------------------------------- sorteos programados y anuncio
    { id: "sorteo_publicacion", origen: "sorteo", categoria: "Publicación", nombre: "Publicación del sorteo", canal: "imagen", seleccion: "copia", envioUnico: "obligatorio", respaldo: "no_enviar", soportado: true, motorActual: PUBLICADOR },
    { id: "sorteo_recordatorio", origen: "sorteo", categoria: "Sorteos programados", nombre: "Recordatorio del sorteo", canal: "texto", seleccion: "copia", envioUnico: "obligatorio", respaldo: "no_enviar", soportado: true, motorActual: PUBLICADOR },
    { id: "sorteo_aviso_cierre", origen: "sorteo", categoria: "Sorteos programados", nombre: "Aviso de cierre del sorteo", canal: "texto", seleccion: "copia", envioUnico: "obligatorio", respaldo: "no_enviar", soportado: true, motorActual: PUBLICADOR },
    { id: "compartir_tabla", origen: "compartir", categoria: "Publicación", nombre: "Compartir tabla", canal: "imagen", seleccion: "copia", envioUnico: "obligatorio", respaldo: "no_enviar", soportado: true, motorActual: COMPARTIR },

    // ------------------------------------------------------------ reacciones
    { id: "reaccion_reserva", origen: "reaccion", categoria: "Reservas", nombre: "Reacción ✅/❌ a la reserva", canal: "reaccion", seleccion: "ninguna", envioUnico: "ninguno", respaldo: "ninguno", soportado: true, motorActual: REACCION },

    // ------------------------------------------- mensajes fijos del sistema
    sistema("sistema_error_consulta", "Error técnico de consulta", CONSULTAS),
    sistema("sistema_sin_sorteo_vigente", "No hay un sorteo activo en el grupo", CONSULTAS),
    sistema("sistema_estado_numero", "Estado de un número (texto fijo)", CONSULTAS),
    sistema("sistema_pregunta_puntual_pago", "Preguntas puntuales de pago", CONSULTAS),
    sistema("sistema_agotado", "Aviso fijo de agotado", CONSULTAS),
    sistema("sistema_error_reserva", "Error técnico de reserva", RESERVAS)

]);

const POR_ID = new Map(TIPOS.map(t => [t.id, t]));

function obtenerTipo(id) {
    return POR_ID.get(id) || null;
}

// Tipo cuyas plantillas e interruptor se usan de verdad (sigue los alias).
function tipoEfectivo(id) {
    const tipo = obtenerTipo(id);
    return tipo?.aliasDe ? obtenerTipo(tipo.aliasDe) : tipo;
}

function tiposPorOrigen(origen) {
    return TIPOS.filter(t => t.origen === origen);
}

// Coherencia interna del catálogo -> lista de errores (vacía = correcto).
function validarCatalogo(tipos = TIPOS) {
    const errores = [];
    const ids = new Set();
    for (const t of tipos) {
        if (!t.id || ids.has(t.id)) errores.push(`id vacío o repetido: ${t.id}`);
        ids.add(t.id);
        if (!ORIGENES.includes(t.origen)) errores.push(`${t.id}: origen desconocido ${t.origen}`);
        if (!CANALES.includes(t.canal)) errores.push(`${t.id}: canal desconocido ${t.canal}`);
        if (!SELECCIONES.includes(t.seleccion)) errores.push(`${t.id}: selección desconocida ${t.seleccion}`);
        if (!ENVIO_UNICO.includes(t.envioUnico)) errores.push(`${t.id}: envío único desconocido ${t.envioUnico}`);
        if (!RESPALDOS.includes(t.respaldo)) errores.push(`${t.id}: respaldo desconocido ${t.respaldo}`);
        if (t.aliasDe && !tipos.some(x => x.id === t.aliasDe)) errores.push(`${t.id}: alias a un tipo inexistente ${t.aliasDe}`);
        if (!t.motorActual) errores.push(`${t.id}: sin motorActual`);
    }
    return errores;
}

module.exports = { TIPOS, ORIGENES, CANALES, SELECCIONES, obtenerTipo, tipoEfectivo, tiposPorOrigen, validarCatalogo };
