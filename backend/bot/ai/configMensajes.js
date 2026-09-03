// Lectura de la configuración de PRESENTACIÓN (Fase 5.4: N plantillas
// habilitadas por tipo + un modo de selección). Solo lectura salvo
// actualizarRotacion (que solo persiste un índice, nunca datos de
// negocio). Si la tabla no existe todavía (migración no aplicada) o hay
// cualquier error, se devuelve null/[] y el sistema sigue funcionando
// exactamente igual que antes (fallback fijo + Gemini genérico).
const supabase = require("../../lib/supabase");

async function obtenerConfigSeleccion(tipoRespuesta, usuarioId) {

    if (!tipoRespuesta || !usuarioId) {
        return null;
    }

    try {

        const { data, error } = await supabase
            .from("configuracion_seleccion_mensajes")
            .select("*")
            .eq("usuario_id", usuarioId)
            .eq("tipo_respuesta", tipoRespuesta)
            .maybeSingle();

        if (error) {

            console.log("⚠️ Configuración de selección no disponible para", tipoRespuesta, "-", error.message);

            return null;

        }

        return data;

    } catch (err) {

        console.log("⚠️ Error leyendo configuración de selección:", err.message);

        return null;

    }

}

async function obtenerPlantillasHabilitadas(tipoRespuesta, usuarioId) {

    if (!tipoRespuesta || !usuarioId) {
        return [];
    }

    try {

        const { data, error } = await supabase
            .from("plantillas_mensaje")
            .select("*")
            .eq("usuario_id", usuarioId)
            .eq("tipo_respuesta", tipoRespuesta)
            .eq("habilitada", true)
            .order("orden", { ascending: true });

        if (error) {

            console.log("⚠️ Plantillas no disponibles para", tipoRespuesta, "-", error.message);

            return [];

        }

        return data || [];

    } catch (err) {

        console.log("⚠️ Error leyendo plantillas habilitadas:", err.message);

        return [];

    }

}

// Fase 5.5: ¿el BOT puede ENVIAR una respuesta de este tipo? Reutiliza
// obtenerConfigSeleccion (misma tabla, misma fila) en vez de duplicar la
// consulta a Supabase — punto único de esta responsabilidad.
//
// IMPORTANTE: esto controla SOLO si se envía el mensaje. Nunca decide si
// se ejecuta la operación real (reserva, consulta ya resuelta) — eso
// sigue ocurriendo siempre, sin excepción, antes de que esta función se
// evalúe.
//
// DEFAULT SEGURO: si no hay usuarioId/tipoRespuesta, si no existe fila de
// configuración todavía, o si Supabase falla (obtenerConfigSeleccion ya
// devuelve null en ese caso), se considera HABILITADA. Así ningún usuario
// existente pierde respuestas por no haber tocado nunca este interruptor.
async function estaRespuestaHabilitada(usuarioId, tipoRespuesta) {

    if (!usuarioId || !tipoRespuesta) {
        return true;
    }

    const config = await obtenerConfigSeleccion(tipoRespuesta, usuarioId);

    if (!config) {
        return true;
    }

    return config.habilitada !== false;

}

// Persiste el índice de rotación. Nunca lanza: un fallo aquí no debe
// impedir que el mensaje ya elegido se envíe.
async function actualizarRotacion(configId, nuevoIndice) {

    try {

        await supabase
            .from("configuracion_seleccion_mensajes")
            .update({
                rotacion_indice: nuevoIndice,
                updated_at: new Date().toISOString()
            })
            .eq("id", configId);

    } catch (err) {

        console.log("⚠️ Error persistiendo índice de rotación:", err.message);

    }

}

module.exports = {
    obtenerConfigSeleccion,
    obtenerPlantillasHabilitadas,
    estaRespuestaHabilitada,
    actualizarRotacion
};
