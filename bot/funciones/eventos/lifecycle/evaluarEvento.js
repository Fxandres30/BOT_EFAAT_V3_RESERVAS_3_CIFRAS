const { verificarHoraCierre } = require("./verificarHoraCierre");
const { verificarTodosPagados } = require("./verificarTodosPagados");

async function evaluarEvento(evento) {

    if (!evento)
        return null;

    if (!evento.activo)
        return null;

    // ======================================
    // 1. Llegó la hora de cierre
    // ======================================

    if (verificarHoraCierre(evento)) {

        return {

            accion: "cerrar",
            motivo: "hora",
            mensaje: "⏰ Se alcanzó la hora de cierre."

        };

    }

    // ======================================
    // 2. Todos los reservados fueron pagados
    // ======================================

    if (await verificarTodosPagados(evento)) {

        return {

            accion: "cerrar",
            motivo: "pagados",
            mensaje: "✅ Todos los números reservados fueron pagados."

        };

    }

    // ======================================
    // Continúa abierto
    // ======================================

    return {

        accion: "continuar",
        motivo: null,
        mensaje: null

    };

}

module.exports = {
    evaluarEvento
};