const { reservaPerteneceAUsuario } = require("../usuarios/obtenerUsuarioGlobal");

// Recibe `usuario` (el objeto ya resuelto por obtenerUsuarioGlobal, el mismo
// que reservarNumeros.js usa para escribir usuario_global_id) en vez de
// telefono/lib sueltos — así "ya es mío" se decide con el MISMO criterio que
// consultarMisNumeros.js/consultarNumero.js (reservaPerteneceAUsuario), en
// vez de una comparación de campos crudos propia que no reconocía reservas
// históricas guardadas con una identidad distinta a la de hoy (ver auditoría
// identidad/eventos, Fase Identidad Real).
function validarReservas(reservas = [], usuario) {

    const disponibles = [];
    const ocupadosPorOtros = [];
    const yaSonMios = [];
    const pagados = [];
    // Bloqueados o en proceso: no se pueden reservar, pero no son «de otra
    // persona» (la reacción ❌ no aplica). También se informan al cliente.
    const noDisponibles = [];

    for (const reserva of reservas) {

        // Número libre
        if (reserva.estado === "libre") {
            disponibles.push(reserva);
            continue;
        }

        // Ocupado por OTRO sorteo en esta cuadrícula: no se puede reservar,
        // aunque sea del mismo cliente (no es un número suyo de este sorteo).
        if (reserva.deOtroSorteo) {
            ocupadosPorOtros.push(reserva);
            continue;
        }

        // Ya pertenece al mismo usuario
        if (reservaPerteneceAUsuario(reserva, usuario)) {
            yaSonMios.push(reserva);
            continue;
        }

        // Pagado por otro usuario
        if (reserva.estado === "pagado") {
            pagados.push(reserva);
            ocupadosPorOtros.push(reserva);
            continue;
        }

        // Reservado por otro usuario
        if (reserva.estado === "reservado") {
            ocupadosPorOtros.push(reserva);
            continue;
        }

        noDisponibles.push(reserva);

    }

    return {

        disponibles,
        ocupadosPorOtros,
        yaSonMios,
        pagados,
        noDisponibles,

        libres: disponibles.length,
        ocupados: ocupadosPorOtros.length,
        mios: yaSonMios.length

    };

}

module.exports = {
    validarReservas
};
