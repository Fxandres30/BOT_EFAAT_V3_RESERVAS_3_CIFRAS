const supabase = require("../../../../lib/supabase");

async function verificarTodosPagados(evento) {

    if (!evento)
        return false;

    // Antes filtraba por evento_id (la fila de eventos_bot de ESTE grupo
    // específico) — si el mismo sorteo real se anuncia en varios grupos,
    // cada reserva/pago queda con el evento_id del grupo donde se hizo, así
    // que este conteo por-grupo nunca veía los pagos hechos a través de los
    // otros grupos del MISMO sorteo, y "todos pagados" podía no cumplirse
    // nunca aunque el sorteo real ya estuviera completo. Se filtra por
    // identidad_evento_real (independiente del grupo, ver
    // identidadEventoReal.js) para contar los pagos de TODOS los grupos que
    // comparten el mismo sorteo real. Si el evento todavía no trae esta
    // identidad (dato histórico previo a esta migración), se mantiene el
    // comportamiento anterior (por evento_id) para no dejar de funcionar.
    let query = supabase
        .from(evento.tabla)
        .select("*", {
            count: "exact",
            head: true
        })
        .eq("estado", "pagado");

    query = evento.identidad_evento_real
        ? query.eq("identidad_evento_real", evento.identidad_evento_real)
        : query.eq("evento_id", evento.id);

    const { count, error } = await query;

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