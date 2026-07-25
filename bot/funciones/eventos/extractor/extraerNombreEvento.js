const { normalizarTexto } = require("../../../utils/normalizarTexto");
const { LOTERIAS } = require("./loterias");

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

    // Fallback si no encuentra una conocida
    return lineaEvento

        .replace(/[🎰⭐🎲🎯]/gu, "")

        .replace(/\*/g, "")

        .replace(/[–—-]/g, " ")

        .replace(/\d{1,2}:\d{2}\s*(am|pm)/i, "")

        .replace(/\s+/g, " ")

        .trim();

}

module.exports = {

    extraerNombreEvento

};