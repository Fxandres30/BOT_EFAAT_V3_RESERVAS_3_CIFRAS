// ==========================================================================
// lib/tiempo/colombia.ts: FUENTE ÚNICA de fecha y hora de Colombia en el
// panel (F1-B, 06/11/2026). Espejo de backend/shared/tiempo/colombia.js:
// mismas expresiones, mismos resultados. El panel no puede importar el
// módulo CommonJS del backend, por eso hay dos archivos y no uno; si cambias
// uno, cambia el otro (lo comprueba tests/utils/tiempoColombia.test.mjs).
//
// America/Bogota: UTC-5 todo el año, sin horario de verano. Puro: sin red.
// Los formatos de PRESENTACIÓN («hoy 2:56 p. m.», dateStyle short…) siguen
// en cada componente: son distintos a propósito.
// ==========================================================================

export const ZONA_COLOMBIA = "America/Bogota";
export const DESFASE_COLOMBIA = "-05:00";

const FORMATO_DIA = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA_COLOMBIA, year: "numeric", month: "2-digit", day: "2-digit" });
const FORMATO_PARTES = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONA_COLOMBIA, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
});

// "YYYY-MM-DD" del día en Colombia.
export function fechaColombia(fecha: Date = new Date()): string {
    return FORMATO_DIA.format(fecha);
}

// { fecha: "YYYY-MM-DD", hora: "HH:MM" } en Colombia.
export function partesColombia(fecha: Date = new Date()): { fecha: string; hora: string } {
    const v = Object.fromEntries(FORMATO_PARTES.formatToParts(fecha).map(p => [p.type, p.value]));
    return { fecha: `${v.year}-${v.month}-${v.day}`, hora: `${v.hour}:${v.minute}` };
}
