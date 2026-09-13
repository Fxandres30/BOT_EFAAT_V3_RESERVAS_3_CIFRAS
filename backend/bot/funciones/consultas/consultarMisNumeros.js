const supabase = require("../../../lib/supabase");

// READ-ONLY. Usa usuario_global_id, el mismo identificador de dueño que
// reservarNumeros.js ya escribe en cada reserva (no se inventa ningún
// criterio nuevo de propiedad). No filtra por evento_id: igual que
// consultarReservas.js y actualizarEvento.js, trata evento.tabla completa
// como el estado vigente (el cierre de evento no resetea las filas).
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

    const { data, error } = await supabase
        .from(evento.tabla)
        .select("numero, estado")
        .eq("usuario_global_id", usuario.id)
        .neq("estado", "libre")
        .order("numero", { ascending: true });

    if (error) {

        console.log("❌ Error consultando mis números:", error.message);

        return [];

    }

    return data || [];

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
