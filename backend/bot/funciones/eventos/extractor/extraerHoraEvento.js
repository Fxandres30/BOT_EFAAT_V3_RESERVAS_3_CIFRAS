function extraerHoraEvento(lineaEvento = "") {

    const match = lineaEvento.match(
        /\b(\d{1,2}):(\d{2})\s*(am|pm)\b/i
    );

    if (!match)
        return null;

    let [, hora, minuto, periodo] = match;

    hora = Number(hora);

    periodo = periodo.toLowerCase();

    if (periodo === "pm" && hora !== 12)
        hora += 12;

    if (periodo === "am" && hora === 12)
        hora = 0;

    return `${String(hora).padStart(2, "0")}:${minuto}`;

}

module.exports = {

    extraerHoraEvento

};