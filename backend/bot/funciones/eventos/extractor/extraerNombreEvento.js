const { normalizarTexto } = require("../../../utils/normalizarTexto");
const { LOTERIAS, LOTERIAS_TRADICIONALES } = require("./loterias");
const { limpiarDecoracion } = require("./normalizarAnuncio");

// Lotería tradicional nombrada en el texto (ya normalizado), o null.
function loteriaTradicional(normalizada = "") {

    return LOTERIAS_TRADICIONALES.find(l => l.patron.test(normalizada)) || null;

}

function extraerNombreEvento(lineaEvento = "") {

    const normalizada = normalizarTexto(lineaEvento);

    // Buscar la lotería conocida más larga primero
    const loteriasOrdenadas = [...LOTERIAS].sort(
        (a, b) => b.length - a.length
    );

    for (const loteria of loteriasOrdenadas) {

        if (
            normalizada.includes(
                normalizarTexto(loteria)
            )
        ) {

            return loteria
                .split(" ")
                .map(p => p.charAt(0).toUpperCase() + p.slice(1))
                .join(" ");

        }

    }

    const tradicional = loteriaTradicional(normalizada);

    if (tradicional) {
        return tradicional.nombre;
    }

    // Fallback si no encuentra una conocida
    return limpiarDecoracion(lineaEvento

        .replace(/[–—-]/g, " ")

        .replace(/\d{1,2}\s*[:.]\s*\d{2}\s*(?:[ap]\s*\.?\s*m\.?)?/i, " ")

        .replace(/\b\d{1,2}\s*[ap]\s*\.?\s*m\b\.?/i, " "));

}

module.exports = {

    extraerNombreEvento,

    loteriaTradicional

};
