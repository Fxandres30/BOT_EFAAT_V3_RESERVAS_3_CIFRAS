// ==========================================================================
// repo/eventosBot.js — SOLO LECTURA de eventos_bot (Fase 4B).
//
// eventos_bot es la tabla del bot EXISTENTE (guardarEvento.js/
// consultarEvento.js) — este archivo NUNCA escribe en ella (ninguna función
// aquí hace .insert()/.update()/.delete()), solo lee, para que el Scheduler
// pueda ver los datos EN VIVO del sorteo real (reservados/libres/activo)
// sin duplicar el sistema de guardado/consulta que ya existe.
//
// consultarEvento.js (bot, sin tocar) busca por grupo_id porque ese es su
// caso de uso (¿hay un evento vigente en este grupo?). El Scheduler ya
// conoce el evento_id exacto (guardado en event_sessions.evento_id), así
// que necesita una lectura distinta, por id — no existía antes.
// ==========================================================================

const supabase = require("../../lib/supabase");

const TABLA = "eventos_bot";

async function obtenerPorId(eventoId) {

    if (!eventoId) return null;

    const { data, error } = await supabase
        .from(TABLA)
        .select("*")
        .eq("id", eventoId)
        .maybeSingle();

    if (error) throw error;

    return data;

}

module.exports = { obtenerPorId };
