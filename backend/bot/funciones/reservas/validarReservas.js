const { clasificarFila } = require("./estadoNumeros");

// Recibe `usuario` (el objeto ya resuelto por obtenerUsuarioGlobal, el mismo
// que reservarNumeros.js usa para escribir usuario_global_id) en vez de
// telefono/lib sueltos — así "ya es mío" se decide con el MISMO criterio que
// consultarMisNumeros.js/consultarNumero.js (reservaPerteneceAUsuario), en
// vez de una comparación de campos crudos propia que no reconocía reservas
// históricas guardadas con una identidad distinta a la de hoy (ver auditoría
// identidad/eventos, Fase Identidad Real).
//
// Cada fila se clasifica con la regla única de estadoNumeros.js. `evento`
// (opcional) permite reconocer las filas de otro sorteo aunque no traigan
// la marca deOtroSorteo de consultarReservas.js.
function validarReservas(reservas = [], usuario, evento = null) {

    const disponibles = [];
    const ocupadosPorOtros = [];
    const yaSonMios = [];
    const pagados = [];
    const bloqueados = [];
    const enProceso = [];
    // Bloqueados, en proceso o en un estado que la regla no contempla: no se
    // pueden reservar, pero no son «de otra persona» (la reacción ❌ no
    // aplica). También se informan al cliente.
    const noDisponibles = [];

    for (const reserva of reservas) {

        switch (clasificarFila(reserva, { evento, usuario })) {

            case "libre":
                disponibles.push(reserva);
                break;

            case "propio":
                yaSonMios.push(reserva);
                break;

            case "ocupado":
                if (reserva.estado === "pagado") pagados.push(reserva);
                ocupadosPorOtros.push(reserva);
                break;

            case "bloqueado":
                bloqueados.push(reserva);
                noDisponibles.push(reserva);
                break;

            case "en_proceso":
                enProceso.push(reserva);
                noDisponibles.push(reserva);
                break;

            default:
                noDisponibles.push(reserva);

        }

    }

    return {

        disponibles,
        ocupadosPorOtros,
        yaSonMios,
        pagados,
        bloqueados,
        enProceso,
        noDisponibles,

        libres: disponibles.length,
        ocupados: ocupadosPorOtros.length,
        mios: yaSonMios.length

    };

}

module.exports = {
    validarReservas
};
