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

    // Hora del día EN COLOMBIA (antes: la hora local del servidor; con el
    // proceso en otra zona, p. ej. UTC, el sorteo se cerraba 5 h antes). Es
    // la misma zona que fechaEventoHoy y que la hora_cierre del anuncio.
    const [h, m] = new Intl.DateTimeFormat("en-GB", {
        timeZone: "America/Bogota",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23"
    }).format(ahora).split(":").map(Number);

    const horaActual =
        h * 60 +
        m;

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