const supabase = require("../../../lib/supabase");

async function actualizarEvento(evento) {

    // Contar estados de la tabla del evento
    let { data, error } = await supabase
        .from(evento.tabla)
        .select("estado, identidad_evento_real");

    // Red de seguridad de despliegue: si la migración 015 (columna
    // identidad_evento_real) todavía no se aplicó en Supabase, Postgres
    // devuelve 42703 (columna inexistente) — se reintenta una vez sin
    // pedirla para no romper el conteo real mientras se aplica la migración.
    if (error?.code === "42703") {

        console.warn("⚠ La columna identidad_evento_real todavía no existe en Supabase (falta aplicar supabase_migrations/015_identidad_evento_real.sql) — contando sin ella por ahora.");

        const reintento = await supabase
            .from(evento.tabla)
            .select("estado");

        data = reintento.data;
        error = reintento.error;

    }

    if (error) {

        console.error(error);
        return false;

    }

    // "libres" es un conteo GLOBAL de la tabla física (nadie lo reclamó
    // todavía, sin importar de qué evento sea la tabla) — igual que antes.
    // "reservados"/"pagados" SÍ se aíslan por el sorteo REAL de este evento
    // (identidad_evento_real, independiente del grupo — ver
    // identidadEventoReal.js): así el conteo de este evento nunca incluye
    // reservas/pagos de otro evento o tenant que comparta la misma tabla
    // física por rango de precio. Una fila sin identidad todavía (dato
    // previo a esta migración) se sigue contando aquí, para no ocultar
    // reservas reales por falta de backfill.
    const identidad = evento.identidad_evento_real || null;
    const esDeEsteEvento = (r) => !identidad || !r.identidad_evento_real || r.identidad_evento_real === identidad;

    const reservados = data.filter(r => r.estado === "reservado" && esDeEsteEvento(r)).length;

    const pagados = data.filter(r => r.estado === "pagado" && esDeEsteEvento(r)).length;

    const libres = data.filter(r => r.estado === "libre").length;

    const pendientes = reservados;

    const { error: updateError } = await supabase
        .from("eventos_bot")
        .update({

            reservados,
            pagados,
            pendientes,
            libres,
            actualizado_en: new Date()

        })
        .eq("id", evento.id);

    if (updateError) {

        console.error(updateError);
        return false;

    }

    return true;

}

module.exports = {
    actualizarEvento
};