function calcularCierre(horaEvento, minutosAntes = 2) {

    if (!horaEvento)
        return null;

    const [hora, minuto] = horaEvento
        .split(":")
        .map(Number);

    const fecha = new Date();

    fecha.setHours(hora);
    fecha.setMinutes(minuto);
    fecha.setSeconds(0);
    fecha.setMilliseconds(0);

    fecha.setMinutes(
        fecha.getMinutes() - minutosAntes
    );

    return fecha
        .toLocaleTimeString("es-CO", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false
        });

}

module.exports = {

    calcularCierre

};