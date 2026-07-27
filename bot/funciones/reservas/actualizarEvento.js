const supabase = require("../../../lib/supabase");

async function actualizarEvento(evento) {

    // Contar estados de la tabla del evento
    const { data, error } = await supabase
        .from(evento.tabla)
        .select("estado");

    if (error) {

        console.error(error);
        return false;

    }

    const reservados = data.filter(r => r.estado === "reservado").length;

    const pagados = data.filter(r => r.estado === "pagado").length;

    const libres = data.filter(r => r.estado === "libre").length;

    const pendientes = reservados;

    const { error: updateError } = await supabase
        .from("eventos_bot")
        .update({

            reservados,
            pagados,
            pendientes,
            libres,
            actualizado_en: new Date()

        })
        .eq("id", evento.id);

    if (updateError) {

        console.error(updateError);
        return false;

    }

    return true;

}

module.exports = {
    actualizarEvento
};