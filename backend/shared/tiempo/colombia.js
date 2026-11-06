// ==========================================================================
// shared/tiempo/colombia.js: FUENTE ÚNICA de fecha y hora de Colombia en
// el backend (F1-B, 06/11/2026).
//
// El negocio vive en America/Bogota: UTC-5 todo el año, sin horario de
// verano. Antes había 13 copias de estos cálculos (Intl.DateTimeFormat,
// toLocaleDateString, "-05:00" escrito a mano). Cada función de aquí
// reproduce EXACTAMENTE la expresión que sustituye (lo comprueba
// tests/utils/tiempoColombia.test.js minuto a minuto), así que centralizar
// no cambia ningún resultado ni el formato de lo que se guarda en la base.
//
// Pura: sin Supabase, sin red. Se puede importar desde bot/, automation/,
// sorteos/, services/ y shared/ sin crear dependencias entre capas.
// ==========================================================================

"use strict";

const ZONA_COLOMBIA = "America/Bogota";
const DESFASE_COLOMBIA = "-05:00";

const FORMATO_PARTES = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONA_COLOMBIA, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
});
const FORMATO_DIA_SEMANA = new Intl.DateTimeFormat("en-US", { timeZone: ZONA_COLOMBIA, weekday: "long" });

const DIAS = { monday: "lunes", tuesday: "martes", wednesday: "miercoles", thursday: "jueves", friday: "viernes", saturday: "sabado", sunday: "domingo" };

// { fecha: "YYYY-MM-DD", hora: "HH:MM" } en Colombia.
function partesColombia(fecha = new Date()) {
    const v = Object.fromEntries(FORMATO_PARTES.formatToParts(fecha).map(p => [p.type, p.value]));
    return { fecha: `${v.year}-${v.month}-${v.day}`, hora: `${v.hour}:${v.minute}` };
}

// "YYYY-MM-DD" del día en Colombia.
const fechaColombia = (fecha = new Date()) => partesColombia(fecha).fecha;

// "HH:MM" (00-23) en Colombia.
const horaColombia = (fecha = new Date()) => partesColombia(fecha).hora;

// Hora (0-23) en Colombia, como número.
const horaNumeroColombia = (fecha = new Date()) => Number(partesColombia(fecha).hora.slice(0, 2));

// Día de la semana en español sin tildes ("lunes"…"domingo"), como las
// claves de dias_permitidos de automation_configs.
const diaSemanaColombia = (fecha = new Date()) => DIAS[FORMATO_DIA_SEMANA.format(fecha).toLowerCase()] || null;

// Fecha y hora con el FORMATO QUE SE GUARDA en las cuadrículas
// (fecha_reserva/hora_reserva, fecha_pago/hora_pago): "YYYY-MM-DD" y la hora
// de toLocaleTimeString("es-CO", hour12:false), p. ej. "8:36:42" (sin cero
// inicial). No cambiar el formato: lo leen instanteColombia, el panel y los
// datos ya guardados.
function fechaHoraRegistro(ahora = new Date()) {
    return {
        fecha: ahora.toLocaleDateString("sv-SE", { timeZone: ZONA_COLOMBIA }),
        hora: ahora.toLocaleTimeString("es-CO", { hour12: false, timeZone: ZONA_COLOMBIA })
    };
}

// "YYYY-MM-DD" + "HH:MM", "HH:MM:SS" o "H:MM:SS" (como los guarda
// fechaHoraRegistro) en hora de Colombia -> Date. null si falta algo o no
// se entiende.
function instanteColombia(fecha, hora) {
    if (!fecha || !hora) return null;
    const m = String(hora).match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (!m) return null;
    const d = new Date(`${fecha}T${m[1].padStart(2, "0")}:${m[2]}:${m[3] || "00"}${DESFASE_COLOMBIA}`);
    return Number.isNaN(d.getTime()) ? null : d;
}

module.exports = {
    ZONA_COLOMBIA,
    DESFASE_COLOMBIA,
    partesColombia,
    fechaColombia,
    horaColombia,
    horaNumeroColombia,
    diaSemanaColombia,
    fechaHoraRegistro,
    instanteColombia
};
