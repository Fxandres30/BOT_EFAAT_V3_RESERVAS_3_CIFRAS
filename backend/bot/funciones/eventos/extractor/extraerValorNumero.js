const { lineasDe, montosEn } = require("./normalizarAnuncio");

function extraerValorNumero(texto = "") {

    const lineas = lineasDe(texto);

    const patronesLinea = [

        /valor\s+numero/i,
        /valor\s+número/i,
        /valor\s+del\s+numero/i,
        /valor\s+del\s+número/i,
        /cada\s+numero/i,
        /cada\s+número/i,

        // Etiquetas equivalentes de otros formatos de anuncio.
        /valor\s+(?:por|x|de\s+cada)\s+n[uú]mero/i,
        /valor\s+(?:de\s+la\s+)?boleta/i,
        /participaci[oó]n/i

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
        // cada número"). Un monto escrito ("$2.000", "2 mil", "2000
        // pesos") se lee como tal; si no, el primer número.
        const inicio = etiqueta.index;
        const restoDespues = linea.slice(inicio + etiqueta[0].length);
        const restoAntes = linea.slice(0, inicio);

        const montoDespues = montosEn(restoDespues)[0];
        if (montoDespues)
            return montoDespues.valor;

        const despues = restoDespues.match(/\d[\d.,]*/);
        const montoAntes = despues ? null : montosEn(restoAntes).pop();
        if (montoAntes)
            return montoAntes.valor;

        const antes = restoAntes.match(/\d[\d.,]*/g);
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
