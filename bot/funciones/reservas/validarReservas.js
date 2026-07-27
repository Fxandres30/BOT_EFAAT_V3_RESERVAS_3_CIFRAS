function validarReservas(reservas = [], telefono, lib) {

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
        const mismoTelefono =
            telefono &&
            reserva.contacto &&
            reserva.contacto === telefono;

        const mismoLib =
            lib &&
            reserva.lib &&
            reserva.lib === lib;

        if (mismoTelefono || mismoLib) {
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