function extraerValorNumero(texto = "") {

    const lineas = texto
        .split("\n")
        .map(l => l.trim())
        .filter(Boolean);

    const patronesLinea = [

        /valor\s+numero/i,
        /valor\s+número/i,
        /valor\s+del\s+numero/i,
        /valor\s+del\s+número/i,
        /cada\s+numero/i,
        /cada\s+número/i

    ];

    for (const linea of lineas) {

        const esLineaValor = patronesLinea.some(
            patron => patron.test(linea)
        );

        if (!esLineaValor)
            continue;

        const match = linea.match(/\$?\s*([\d.,]+)/);

        if (!match)
            continue;

        const valor = Number(
            match[1].replace(/[.,]/g, "")
        );

        if (!Number.isNaN(valor))
            return valor;

    }

    return null;

}

module.exports = {
    extraerValorNumero
};