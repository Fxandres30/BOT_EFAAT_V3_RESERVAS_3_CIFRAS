const supabase = require("../../../lib/supabase");

async function consultarReservas(evento, numeros) {

    const { data, error } = await supabase
        .from(evento.tabla)
        .select("*")
        .in("numero", numeros);

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