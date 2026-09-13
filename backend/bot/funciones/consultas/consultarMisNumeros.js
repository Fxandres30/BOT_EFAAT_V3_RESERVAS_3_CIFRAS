const supabase = require("../../../lib/supabase");

// READ-ONLY. Busca por usuario_global_id (el identificador de dueño que
// reservarNumeros.js ya escribe en cada reserva) Y, como respaldo, por
// lid/telefono/contacto del mismo usuario ya resuelto — así una reserva
// HISTÓRICA guardada con usuario_global_id=NULL (antes de que existiera esa
// columna, o de una identidad todavía no completada ese día) pero con
// lid/telefono coincidentes sigue reconociéndose como del mismo usuario. No
// se inventa ningún criterio nuevo: es el mismo reservaPerteneceAUsuario()
// que ya usa validarReservas.js. Se aísla por identidad_evento_real (ver
// más abajo) pero no por evento_id/grupo_id: sigue tratando evento.tabla
// completa (para el sorteo real de este evento) como el estado vigente (el
// cierre de evento no resetea las filas).
//
// Única consulta real a Supabase para "los números de este usuario en este
// evento" — tanto consultarMisNumeros() (comportamiento original, sin
// cambios) como consultarMisNumerosPorEstado() (nueva, separa
// reservado/pagado) reutilizan esta misma función en vez de duplicar el
// acceso a datos.
async function obtenerFilasDelUsuario({ evento, usuario }) {

    if (!evento?.tabla || !usuario?.id) {
        return [];
    }

    const condiciones = [`usuario_global_id.eq.${usuario.id}`];

    if (usuario.lid) {
        condiciones.push(`lid.eq.${usuario.lid}`);
    }

    if (usuario.telefono) {
        condiciones.push(`telefono.eq.${usuario.telefono}`);
        condiciones.push(`contacto.eq.${usuario.telefono}`);
    }

    let { data, error } = await supabase
        .from(evento.tabla)
        .select("numero, estado, usuario_global_id, lid, telefono, contacto, identidad_evento_real")
        .or(condiciones.join(","))
        .neq("estado", "libre")
        .order("numero", { ascending: true });

    // Red de seguridad de despliegue: si la migración 015 (columna
    // identidad_evento_real) todavía no se aplicó en Supabase, Postgres
    // devuelve 42703 (columna inexistente) — se reintenta una vez sin
    // pedirla para no romper "mis números" mientras se aplica la migración.
    if (error?.code === "42703") {

        console.warn("⚠ La columna identidad_evento_real todavía no existe en Supabase (falta aplicar supabase_migrations/015_identidad_evento_real.sql) — consultando sin ella por ahora.");

        const reintento = await supabase
            .from(evento.tabla)
            .select("numero, estado, usuario_global_id, lid, telefono, contacto")
            .or(condiciones.join(","))
            .neq("estado", "libre")
            .order("numero", { ascending: true });

        data = reintento.data;
        error = reintento.error;

    }

    if (error) {

        console.log("❌ Error consultando mis números:", error.message);

        return [];

    }

    const filas = data || [];

    // Aísla del mismo sorteo real (independiente del grupo) — una reserva
    // del mismo usuario pero de OTRO evento/ciclo (mismo precio, tabla
    // física compartida) no debe mezclarse en "mis números" de este evento.
    // Ver identidadEventoReal.js. Una fila sin identidad todavía (dato
    // previo a esta migración) se sigue incluyendo, para no ocultar
    // reservas reales por falta de backfill.
    const identidad = evento.identidad_evento_real || null;

    return identidad
        ? filas.filter(f => !f.identidad_evento_real || f.identidad_evento_real === identidad)
        : filas;

}

async function consultarMisNumeros({ evento, usuario }) {

    const filas = await obtenerFilasDelUsuario({ evento, usuario });

    return filas.map(r => r.numero);

}

// NUEVO — mismos datos que consultarMisNumeros(), separados por estado
// real. Usado por las consultas de pendientes/pagados/cantidad separada/
// consulta_pago (ver resolverConsulta.js). No inventa ningún estado: solo
// clasifica lo que ya trae la fila ("reservado" / "pagado" — los únicos
// dos valores no-libres que existen en las tablas dinámicas).
async function consultarMisNumerosPorEstado({ evento, usuario }) {

    const filas = await obtenerFilasDelUsuario({ evento, usuario });

    const reservados = filas.filter(f => f.estado === "reservado").map(f => f.numero);
    const pagados = filas.filter(f => f.estado === "pagado").map(f => f.numero);

    return {
        total: filas.length,
        reservados,
        pagados
    };

}

module.exports = {
    consultarMisNumeros,
    consultarMisNumerosPorEstado
};
