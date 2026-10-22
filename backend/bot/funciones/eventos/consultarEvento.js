const supabase = require("../../../lib/supabase");

// Sorteo (eventos_bot) de un grupo PARA UN CLIENTE. usuarioId es el dueño
// validado de la sesión que recibió el mensaje (sock.context.usuarioId) o
// del sorteo programado — nunca algo inferido del mensaje.
//
// Multisesión (2026-10-21): con varios WhatsApp conectados a la vez, el de
// otro cliente puede estar en el mismo grupo. Sin el filtro, ese otro
// cliente leería (y guardarEvento.js reescribiría) el sorteo de este. Sin
// dueño: null (falla cerrado).
async function consultarEvento(grupoId, usuarioId) {

    if (!grupoId || !usuarioId) {

        if (grupoId) console.error("❌ [EVENTO] consulta sin dueño (usuario_id): no se devuelve ningún sorteo del grupo.");

        return null;

    }

    const { data, error } = await supabase
        .from("eventos_bot")
        .select("*")
        .eq("grupo_id", grupoId)
        .eq("usuario_id", usuarioId)
        .maybeSingle();

    if (error) {

        console.log(error.message);

        return null;

    }

    return data;

}

module.exports = {
    consultarEvento
};
