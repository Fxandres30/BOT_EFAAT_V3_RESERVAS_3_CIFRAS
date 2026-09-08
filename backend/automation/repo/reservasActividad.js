// ==========================================================================
// repo/reservasActividad.js — SOLO LECTURA de reservas_actividad (Fase 4B).
//
// reservas_actividad es el log de auditoría EXISTENTE (002_reservas_
// actividad.sql, alimentado por bot/funciones/reservas/reservarNumeros.js)
// — este archivo nunca inserta/actualiza nada ahí, solo cuenta. Es la
// fuente de datos que UPDATE_MESSAGE necesita para decidir "¿hubo
// suficiente movimiento nuevo desde la última actualización?" sin
// inventar un algoritmo de reservas nuevo (se pidió explícitamente
// reutilizar los datos existentes).
// ==========================================================================

const supabase = require("../../lib/supabase");

const TABLA = "reservas_actividad";

// Cuenta filas tipo="reservado" de un evento concreto desde una fecha
// (inclusive). `desde` puede ser un ISO string o un Date — evento_id no
// tiene FK real (ver 002_reservas_actividad.sql), por eso además se acota
// por tiempo: el mismo evento_id puede repetirse entre ciclos distintos de
// un mismo grupo (igual limitación ya documentada para eventos_bot.id en
// Fase 2A), así que sin el corte por fecha se contarían reservas de un
// sorteo anterior.
async function contarNuevasReservas({ eventoId, desde }) {

    if (!eventoId || !desde) return 0;

    const desdeIso = desde instanceof Date ? desde.toISOString() : desde;

    const { data, error } = await supabase
        .from(TABLA)
        .select("id")
        .eq("evento_id", eventoId)
        .eq("tipo", "reservado")
        .gte("creado_en", desdeIso);

    if (error) throw error;

    return (data || []).length;

}

module.exports = { contarNuevasReservas };
