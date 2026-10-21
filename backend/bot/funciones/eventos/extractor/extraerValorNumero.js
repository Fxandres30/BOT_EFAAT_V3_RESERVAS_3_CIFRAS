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

    for (const lineaOriginal of lineas) {

        // La hora de la misma línea ("Lotería de Bogotá 10:30 valor número
        // 5000") nunca es el precio.
        const linea = lineaOriginal.replace(/\b\d{1,2}\s*:\s*\d{2}\b/g, " ");

        const etiqueta = patronesLinea
            .map(patron => linea.match(patron))
            .find(Boolean);

        if (!etiqueta)
            continue;

        // El precio es el número que SIGUE a la etiqueta ("valor número
        // 5000"); si no hay ninguno después, el que la precede ("$2.000
        // cada número").
        const inicio = etiqueta.index;
        const despues = linea.slice(inicio + etiqueta[0].length).match(/\d[\d.,]*/);
        const antes = linea.slice(0, inicio).match(/\d[\d.,]*/g);
        const encontrado = despues ? despues[0] : antes?.[antes.length - 1];

        if (!encontrado)
            continue;

        const valor = Number(
            encontrado.replace(/[.,]/g, "")
        );

        if (!Number.isNaN(valor))
            return valor;

    }

    return null;

}
module.exports = {
    extraerValorNumero
};