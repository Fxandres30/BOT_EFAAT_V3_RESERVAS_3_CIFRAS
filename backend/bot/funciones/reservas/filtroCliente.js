// ==========================================================================
// filtroCliente.js — restringe una consulta a las tablas de reservas a la
// cuadrícula del CLIENTE dueño del evento (usuario_id).
//
// Las tablas físicas (reservas_dos_cifras, 5k_15k_reservas_2_cifras) tienen
// una cuadrícula 00-99 POR cliente (frontend/services/tablas/
// reiniciarTabla.ts). Sin este filtro, una reserva podía tomar números de la
// cuadrícula de otro cliente y las consultas mezclaban ambas.
//
// Un evento sin usuario_id (dato antiguo) conserva el comportamiento previo.
// Auditoría real (2026-10-14): 0 filas con usuario_id nulo y todas las filas
// pertenecen al único cliente con sorteos, así que hoy es un no-op.
// ==========================================================================

function soloDelCliente(query, evento) {
    return evento?.usuario_id ? query.eq("usuario_id", evento.usuario_id) : query;
}

module.exports = { soloDelCliente };
