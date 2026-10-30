const supabase = require("../../../lib/supabase");
const { soloDelCliente } = require("./filtroCliente");

// Filas de los números pedidos en la cuadrícula del cliente, TODAS: un número
// que un sorteo distinto tiene reservado o pagado sigue ocupado en esta
// cuadrícula aunque no sea de este sorteo. Antes esas filas se excluían de la
// consulta, y el número desaparecía: ni libre ni ocupado, sin avisar al
// cliente, y una reserva parcial se respondía como completa. Ahora vuelven
// marcadas con deOtroSorteo (misma regla de identidad: identidadEventoReal.js;
// un libre o una fila sin identidad no son de otro sorteo).
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

    const identidad = evento?.identidad_evento_real;

    const data = (filas || []).map(f => (
        identidad && f.estado !== "libre" && f.identidad_evento_real && f.identidad_evento_real !== identidad
            ? { ...f, deOtroSorteo: true }
            : f
    ));

    console.log("================================");
    console.log("📋 RESERVAS ENCONTRADAS");
    console.log("================================");
    console.dir(data, { depth: null });

    return data;

}

module.exports = {
    consultarReservas
};