// ==========================================================================
// repo/messages.js — SOLO persistencia del Message Pool
// (automation_messages) y su registro de uso (automation_message_uses).
//
// Sin reglas de negocio aquí (la selección aleatoria/anti-repetición vive
// en messageSelector.js) y sin orquestación (eso vive en engine.js).
// ==========================================================================

const supabase = require("../../lib/supabase");

// Junta mensajes GLOBALES (usuario_id is null) + PROPIOS del usuario que
// detectó el evento, activos, del tipo pedido (y categoría, si se pasa).
// Dos consultas simples en vez de un único ".or(...)" — evita depender de
// sintaxis PostgREST más compleja para algo que dos ".eq()" resuelven con
// total claridad.
async function obtenerMensajesActivos({ usuarioId, tipo, categoria = null }) {

    let propiosQuery = supabase
        .from("automation_messages")
        .select("*")
        .eq("tipo", tipo)
        .eq("activo", true)
        .eq("usuario_id", usuarioId);

    let globalesQuery = supabase
        .from("automation_messages")
        .select("*")
        .eq("tipo", tipo)
        .eq("activo", true)
        .is("usuario_id", null);

    if (categoria) {
        propiosQuery = propiosQuery.eq("categoria", categoria);
        globalesQuery = globalesQuery.eq("categoria", categoria);
    }

    const [propios, globales] = await Promise.all([propiosQuery, globalesQuery]);

    if (propios.error) throw propios.error;
    if (globales.error) throw globales.error;

    return [...(propios.data || []), ...(globales.data || [])];

}

async function registrarUso({
    mensajeId,
    eventSessionId = null,
    usuarioId,
    grupoId,
    tipo,
    categoria = null
}) {

    const { data, error } = await supabase
        .from("automation_message_uses")
        .insert({

            message_id: mensajeId,
            event_session_id: eventSessionId,
            usuario_id: usuarioId,
            grupo_id: grupoId,
            tipo,
            categoria

        })
        .select()
        .single();

    if (error) throw error;

    return data;

}

// Devuelve el id del último mensaje usado para (usuario, grupo, tipo), o
// null si nunca se usó ninguno — base de "excluir el último mensaje
// utilizado cuando sea posible" (messageSelector.js).
async function obtenerUltimoMensajeUsado({ usuarioId, grupoId, tipo }) {

    const { data, error } = await supabase
        .from("automation_message_uses")
        .select("message_id")
        .eq("usuario_id", usuarioId)
        .eq("grupo_id", grupoId)
        .eq("tipo", tipo)
        .order("usado_en", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) throw error;

    return data ? data.message_id : null;

}

module.exports = {
    obtenerMensajesActivos,
    registrarUso,
    obtenerUltimoMensajeUsado
};
