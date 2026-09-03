const supabase = require("../../../lib/supabase");

async function consultarEvento(grupoId) {

    const { data, error } = await supabase
        .from("eventos_bot")
        .select("*")
        .eq("grupo_id", grupoId)
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