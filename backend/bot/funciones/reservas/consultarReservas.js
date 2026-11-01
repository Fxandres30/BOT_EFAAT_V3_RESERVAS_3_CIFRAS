const supabase = require("../../../lib/supabase");
const { soloDelCliente } = require("./filtroCliente");

// Filas de los números pedidos en la cuadrícula del cliente, TODAS. La tabla
// es el sorteo (UNA TABLA = UN SORTEO, 31/10/2026): ninguna fila se separa
// por identidad, evento o grupo; estadoNumeros.js decide propio/ocupado
// solo por el estado y el dueño.
//
// Devuelve null si no se pudo leer: «no sé» no es lo mismo que «no hay filas».
async function consultarReservas(evento, numeros) {

    const query = soloDelCliente(
        supabase
            .from(evento.tabla)
            .select("*")
            .in("numero", numeros),
        evento
    );

    const { data: filas, error } = await query;

    if (error) {
        console.error(error);
        return null;
    }

    const data = filas || [];

    console.log("================================");
    console.log("📋 RESERVAS ENCONTRADAS");
    console.log("================================");
    console.dir(data, { depth: null });

    return data;

}

module.exports = {
    consultarReservas
};