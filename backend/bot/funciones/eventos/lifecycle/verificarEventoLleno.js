const supabase = require("../../../../lib/supabase");

async function verificarEventoLleno(evento) {

    if (!evento)
        return false;

    // La tabla física es compartida (una cuadrícula por usuario_id): sin
    // dueño del sorteo no se cuenta nada (falla cerrado).
    if (!evento.usuario_id)
        return false;

    const { count, error } = await supabase
        .from(evento.tabla)
        .select("*", {
            count: "exact",
            head: true
        })
        .eq("usuario_id", evento.usuario_id)
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