function verificarHoraCierre(evento) {

    if (!evento)
        return false;

    if (!evento.hora_cierre)
        return false;

    const ahora = new Date();

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