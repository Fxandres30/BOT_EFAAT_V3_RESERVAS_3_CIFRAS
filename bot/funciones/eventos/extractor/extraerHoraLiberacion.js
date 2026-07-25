function extraerHoraLiberacion(texto = "") {

    const lineas = texto
        .split("\n")
        .map(l => l.trim())
        .filter(Boolean);

    for (const linea of lineas) {

        const minuscula = linea.toLowerCase();

        if (
            !minuscula.includes("liberad")
        ) {
            continue;
        }

        const match = linea.match(
            /\b(\d{1,2}):(\d{2})\s*(am|pm)\b/i
        );

        if (!match)
            continue;

        let [, hora, minuto, periodo] = match;

        hora = Number(hora);

        periodo = periodo.toLowerCase();

        if (periodo === "pm" && hora !== 12)
            hora += 12;

        if (periodo === "am" && hora === 12)
            hora = 0;

        return `${String(hora).padStart(2, "0")}:${minuto}`;

    }

    return null;

}

module.exports = {

    extraerHoraLiberacion

};