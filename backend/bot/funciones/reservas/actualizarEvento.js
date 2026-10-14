const supabase = require("../../../lib/supabase");
const { estadoDelSorteo } = require("../eventos/sorteoReal");

// ==========================================================================
// Contadores del sorteo (reservados / pagados / pendientes / libres) que
// muestra el panel en cada fila de eventos_bot.
//
// Se calculan con la MISMA lectura que decide el cierre (sorteoReal.js):
// números ÚNICOS de la tabla real del sorteo. Antes contaban filas sueltas
// (incluidas filas sin identidad y de otros tenants) y podían mostrar
// "100 pagados" mientras el cierre veía menos. Todas las filas (grupos) del
// mismo sorteo muestran los MISMOS totales: nunca se suman entre grupos.
// ==========================================================================

function contadoresDe(estado) {

    return {
        reservados: estado.reservados,
        pagados: estado.pagados,
        pendientes: estado.reservados,
        libres: estado.libres
    };

}

// Escribe los contadores en cada fila que los tenga distintos. Best-effort:
// nunca lanza y nunca bloquea el flujo que lo llama.
async function sincronizarContadores(filas, estado) {

    const contadores = contadoresDe(estado);
    let ok = true;

    for (const fila of filas || []) {

        const igual = Object.keys(contadores).every(k => Number(fila[k]) === contadores[k]);

        if (igual) continue;

        try {

            const { error } = await supabase
                .from("eventos_bot")
                .update({ ...contadores, actualizado_en: new Date() })
                .eq("id", fila.id);

            if (error) {
                ok = false;
                console.error("❌ No se pudieron actualizar los contadores del evento", fila.id, error.message);
            } else {
                Object.assign(fila, contadores);
            }

        } catch (err) {

            ok = false;
            console.error("❌ No se pudieron actualizar los contadores del evento", fila.id, err?.message);

        }

    }

    return ok;

}

// Filas activas de eventos_bot del MISMO sorteo lógico (todos sus grupos).
async function filasDelSorteo(evento) {

    if (!evento.identidad_evento_real) return [evento];

    let query = supabase
        .from("eventos_bot")
        .select("*")
        .eq("identidad_evento_real", evento.identidad_evento_real);

    if (evento.usuario_id) query = query.eq("usuario_id", evento.usuario_id);

    const { data, error } = await query;

    if (error || !data?.length) return [evento];

    return data;

}

async function actualizarEvento(evento) {

    if (!evento) return false;

    const estado = await estadoDelSorteo(evento);

    if (!estado.ok) {

        console.error("❌ No se pudo leer la tabla del sorteo para actualizar contadores:", estado.error);
        return false;

    }

    return sincronizarContadores(await filasDelSorteo(evento), estado);

}

module.exports = {
    actualizarEvento,
    sincronizarContadores
};
