const {
    buscarLineaEvento,
    extraerNombreEvento,
    extraerHoraEvento,
    extraerHoraLiberacion,
    extraerValorNumero,
    extraerPremios,
    calcularCierre
} = require("./extractor");

function extraerEvento(texto = "") {

    const lineaEvento = buscarLineaEvento(texto);

    if (!lineaEvento) {
        return null;
    }

    const nombre = extraerNombreEvento(lineaEvento);
    const hora = extraerHoraEvento(lineaEvento);
    const horaLiberacion = extraerHoraLiberacion(texto);
    const valor = extraerValorNumero(texto);
    const premios = extraerPremios(texto);

    return {

        nombre: nombre || null,

        hora: hora || null,

        horaCierre: hora
            ? calcularCierre(hora)
            : null,

        horaLiberacion: horaLiberacion || null,

        valor: valor || null,

        premios

    };

}

module.exports = {
    extraerEvento
};