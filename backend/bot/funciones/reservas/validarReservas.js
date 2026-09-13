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

    for (const reserva of reservas) {

        // Número libre
        if (reserva.estado === "libre") {
            disponibles.push(reserva);
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

    }

    return {

        disponibles,
        ocupadosPorOtros,
        yaSonMios,
        pagados,

        libres: disponibles.length,
        ocupados: ocupadosPorOtros.length,
        mios: yaSonMios.length

    };

}

module.exports = {
    validarReservas
};
