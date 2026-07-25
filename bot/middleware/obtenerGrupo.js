const supabase = require("../../lib/supabase");

module.exports = async function obtenerGrupo(chat) {

    // Si el mensaje es privado
    if (!chat.esGrupo) {

        return null;

    }

    const { data, error } = await supabase

        .from("grupos")

        .select("*")

        .eq("jid", chat.remoteJid)

        .single();

    if (error || !data) {

        console.log(
            "⚠️ Grupo no registrado:",
            chat.remoteJid
        );

        return null;

    }

    return data;

};