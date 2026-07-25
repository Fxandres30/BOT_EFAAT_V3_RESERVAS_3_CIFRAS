const supabase = require("../../../lib/supabase");

async function obtenerUsuarioGlobal(jidUsuario) {

    let telefono = null;
    let lid = null;

    // TELEFONO
    if (jidUsuario.includes("@s.whatsapp.net")) {

        telefono = jidUsuario
            .replace("@s.whatsapp.net", "")
            .replace(/^57/, "");
    }

    // LID
    if (jidUsuario.includes("@lid")) {
        lid = jidUsuario;
    }

    let telefonoFinal = telefono;
    let lidFinal = lid;

    // SI VIENE TELEFONO → BUSCAR LID
    if (telefonoFinal) {

        const { data } = await supabase
            .from("usuarios")
            .select("lid")
            .eq("telefono", telefonoFinal)
            .limit(1);

        if (data?.length) {
            lidFinal = data[0].lid;
        }
    }

    // SI VIENE LID → BUSCAR TELEFONO
    if (!telefonoFinal && lidFinal) {

        const { data } = await supabase
            .from("usuarios")
            .select("telefono")
            .eq("lid", lidFinal)
            .limit(1);

        if (data?.length) {

            telefonoFinal = data[0].telefono;

        } else {

            console.log("⚠️ LID sin teléfono:", lidFinal);

        }
    }

    if (!telefonoFinal && !lidFinal) {
        return null;
    }

    return {

        telefono: telefonoFinal,

        lid: lidFinal,

        jid: telefonoFinal
            ? `${telefonoFinal}@s.whatsapp.net`
            : lidFinal

    };

}

module.exports = {
    obtenerUsuarioGlobal
};