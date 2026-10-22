// ==========================================================================
// filtroCliente.js — restringe una consulta a las tablas de reservas a la
// cuadrícula del CLIENTE dueño del evento (usuario_id).
//
// Las tablas físicas (reservas_dos_cifras, 5k_15k_reservas_2_cifras) tienen
// una cuadrícula 00-99 POR cliente (frontend/services/tablas/
// reiniciarTabla.ts). Sin este filtro, una reserva podía tomar números de la
// cuadrícula de otro cliente y las consultas mezclaban ambas.
//
// Un evento SIN usuario_id se rechaza (falla cerrado, 2026-10-21): antes la
// consulta salía sin filtro y, con dos clientes en la misma tabla física,
// una reserva habría tomado los números de ambos. La consulta rechazada no
// llega a Supabase: responde { data: null, error: SIN_PROPIETARIO } sea cual
// sea la cadena que le siga (.select(), .or(), .maybeSingle()…), y todos los
// llamadores ya tratan un error como "sin resultados".
// Auditoría real (2026-10-14): 0 eventos y 0 filas con usuario_id nulo.
// ==========================================================================

const SIN_PROPIETARIO = "SIN_PROPIETARIO";

function consultaRechazada() {

    const resultado = {
        data: null,
        count: null,
        error: { code: SIN_PROPIETARIO, message: "Evento sin usuario_id: operación de reservas rechazada." }
    };

    const consulta = new Proxy(function () {}, {
        get(_destino, propiedad) {
            if (propiedad === "then") return (ok, ko) => Promise.resolve(resultado).then(ok, ko);
            return () => consulta;
        }
    });

    return consulta;

}

function soloDelCliente(query, evento) {

    if (evento?.usuario_id) return query.eq("usuario_id", evento.usuario_id);

    console.error(`❌ [RESERVAS] evento ${evento?.id ?? "?"} sin usuario_id: operación rechazada (no se toca ninguna cuadrícula).`);

    return consultaRechazada();

}

module.exports = { soloDelCliente, SIN_PROPIETARIO };
