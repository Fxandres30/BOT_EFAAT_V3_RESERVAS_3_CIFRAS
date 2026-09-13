const supabase = require("../../../lib/supabase");

async function consultarReservas(evento, numeros) {

    let query = supabase
        .from(evento.tabla)
        .select("*")
        .in("numero", numeros);

    // Aísla del mismo sorteo real (independiente del grupo) frente a otros
    // eventos/tenants que compartan la misma tabla física por rango de
    // precio — sin dejar de compartirla entre los grupos que son el MISMO
    // sorteo (ver identidadEventoReal.js). Un número LIBRE siempre debe
    // verse (nadie lo reclamó todavía) y una fila sin identidad todavía
    // (dato previo a esta migración, o sin backfill) nunca se oculta — solo
    // se EXCLUYE lo que ya está reservado/pagado por un evento distinto.
    if (evento?.identidad_evento_real) {
        query = query.or(
            `identidad_evento_real.eq.${evento.identidad_evento_real},identidad_evento_real.is.null,estado.eq.libre`
        );
    }

    const { data, error } = await query;

    if (error) {
        console.error(error);
        return [];
    }

    console.log("================================");
    console.log("📋 RESERVAS ENCONTRADAS");
    console.log("================================");
    console.dir(data, { depth: null });

    return data;

}

module.exports = {
    consultarReservas
};