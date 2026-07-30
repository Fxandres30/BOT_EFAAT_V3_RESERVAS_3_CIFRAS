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

    console.log("================================");
    console.log("Hora servidor:", `${ahora.getHours()}:${ahora.getMinutes()}`);
    console.log("Hora cierre:", evento.hora_cierre);
    console.log("Actual:", horaActual);
    console.log("Cierre:", horaCierre);
    console.log("¿Cerrar?:", horaActual >= horaCierre);
    console.log("================================");

    return horaActual >= horaCierre;

}

module.exports = {
    verificarHoraCierre
};