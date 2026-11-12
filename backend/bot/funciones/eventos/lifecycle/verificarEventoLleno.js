const supabase = require("../../../../lib/supabase");

async function verificarEventoLleno(evento) {

    if (!evento)
        return false;

    // La tabla física es compartida (una cuadrícula por usuario_id): sin
    // dueño del sorteo no se cuenta nada (falla cerrado).
    if (!evento.usuario_id)
        return false;

    // Motor nuevo: reservados + pagados de la rifa del sorteo (evento.tabla_id).
    if (require("../../../../rifas/motor").motorNuevo()) {
        const filas = await require("../../../../rifas/bot").leerFilas(evento, { estados: ["reservado", "pagado"] });
        if (filas === null) return false;
        return filas.length >= (Number(evento.cantidad_numeros) || Infinity);
    }

    const { count, error } = await supabase
        .from(evento.tabla)
        .select("*", {
            count: "exact",
            head: true
        })
        .eq("usuario_id", evento.usuario_id)
        // La tabla del cliente es el sorteo: antes contaba solo evento_id
        // (el grupo) y no veía lo reservado por otros grupos ni a mano.
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