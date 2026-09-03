const supabase = require("../../../../lib/supabase");

async function verificarTodosPagados(evento) {

    if (!evento)
        return false;

    const { count, error } = await supabase
        .from(evento.tabla)
        .select("*", {
            count: "exact",
            head: true
        })
        .eq("evento_id", evento.id)
        .eq("estado", "pagado");

    if (error) {

        console.log("❌ Error verificando pagos");
        console.dir(error, { depth: null });

        return false;

    }

    return count >= evento.cantidad_numeros;

}

module.exports = {
    verificarTodosPagados
};