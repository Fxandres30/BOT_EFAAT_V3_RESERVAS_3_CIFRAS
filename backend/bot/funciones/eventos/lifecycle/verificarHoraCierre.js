const { fechaEventoHoy } = require("../identidadEventoReal");

function verificarHoraCierre(evento, ahora = new Date()) {

    if (!evento)
        return false;

    if (!evento.hora_cierre)
        return false;

    // Sorteo de un día posterior (publicado de noche para mañana): todavía
    // no llega su cierre. Sin fecha, de hoy o de días anteriores: la
    // comparación por hora de siempre.
    if (evento.fecha_evento && String(evento.fecha_evento).slice(0, 10) > fechaEventoHoy(ahora))
        return false;

    const horaActual =
        ahora.getHours() * 60 +
        ahora.getMinutes();

    const [hora, minuto] =
        evento.hora_cierre
            .split(":")
            .map(Number);

    const horaCierre =
        (hora * 60) + minuto;

    return horaActual >= horaCierre;

}

module.exports = {
    verificarHoraCierre
};