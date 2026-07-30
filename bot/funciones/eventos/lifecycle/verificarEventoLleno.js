const supabase = require("../../../../lib/supabase");

async function verificarEventoLleno(evento) {

    if (!evento)
        return false;

    const { count, error } = await supabase
        .from(evento.tabla)
        .select("*", {
            count: "exact",
            head: true
        })
        .eq("evento_id", evento.id)
        .in("estado", ["reservado", "pagado"]);

    if (error) {

        console.log("❌ Error verificando evento lleno");
        console.dir(error, { depth: null });

        return false;

    }

    console.log(`📊 Reservados: ${count}/${evento.cantidad_numeros}`);

    return count >= evento.cantidad_numeros;

}

module.exports = {
    verificarEventoLleno
};