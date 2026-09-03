const supabase = require("../../../../lib/supabase");
const { cerrarGrupo } = require("../grupos/cerrarGrupo");

async function cerrarEvento({

    sock,
    evento,
    motivo

}) {

    if (!evento) return false;

    if (!evento.activo) return true;

    const { error } = await supabase
        .from("eventos_bot")
        .update({

            activo: false,
            abierto: false,
            estado: "cerrado",
            actualizado_en: new Date().toISOString()

        })
        .eq("id", evento.id);

    if (error) {

        console.log("❌ Error cerrando evento");
        console.dir(error, { depth: null });

        return false;

    }

    try {

        const cerrado = await cerrarGrupo({

            sock,
            grupoId: evento.grupo_id

        });

        if (cerrado) {

            console.log("🔒 Grupo cerrado");

        }

    } catch (error) {

        console.log("❌ Error cerrando grupo");
        console.dir(error, { depth: null });

    }

    console.log(`🔒 Evento ${evento.id} cerrado (${motivo})`);

    return true;

}

module.exports = {
    cerrarEvento
};