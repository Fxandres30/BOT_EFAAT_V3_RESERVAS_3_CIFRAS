const { lineasDe, parsearHora } = require("./normalizarAnuncio");

function extraerHoraLiberacion(texto = "") {

    for (const linea of lineasDe(texto)) {

        const minuscula = linea.toLowerCase();

        if (
            !minuscula.includes("liberad")
        ) {
            continue;
        }

        const hora = parsearHora(linea);

        if (hora)
            return hora;

    }

    return null;

}

module.exports = {

    extraerHoraLiberacion

};
