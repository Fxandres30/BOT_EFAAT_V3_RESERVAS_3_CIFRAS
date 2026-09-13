// ==========================================================================
// repo/plantillasMensaje.js — SOLO LECTURA de plantillas_mensaje para
// Inicio del día (Master Spec §15).
//
// Misma tabla y mismo criterio que bot/ai/configMensajes.js::
// obtenerPlantillasHabilitadas() (tipo_respuesta + habilitada=true) — se
// reimplementa aquí, en vez de importarse, porque automation/ tiene
// prohibido requerir nada bajo bot/ (mismo límite ya documentado en
// automation/tablaInicial.js). Es la MISMA consulta, no una lógica nueva.
// ==========================================================================

const supabase = require("../../lib/supabase");

async function obtenerPlantillasHabilitadas(usuarioId, tipoRespuesta) {

    const { data, error } = await supabase
        .from("plantillas_mensaje")
        .select("*")
        .eq("usuario_id", usuarioId)
        .eq("tipo_respuesta", tipoRespuesta)
        .eq("habilitada", true);

    if (error) throw error;

    return data || [];

}

module.exports = {
    obtenerPlantillasHabilitadas
};
