const {
    buscarLineaEvento,
    extraerNombreEvento,
    extraerHoraEvento,
    extraerHoraLiberacion,
    extraerValorNumero,
    extraerPremios,
    calcularCierre
} = require("./extractor");
const { obtenerConfiguracion } = require("./configEvento");

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

// ¿El texto tiene forma de ANUNCIO de sorteo? Mismo criterio con el que
// detectarEvento.js acepta un anuncio: línea de evento (lotería + hora) y
// un precio con configuración real (configEvento.js). Lo usa
// eventHandler.js para no interpretar además ese mismo mensaje como
// consulta o reserva de un cliente (la hora "10:40" o "Números
// disponibles" de un anuncio no son un pedido).
function pareceAnuncioDeSorteo(texto = "") {

    const evento = extraerEvento(texto);

    return !!evento && !!obtenerConfiguracion(evento.valor);

}

module.exports = {
    extraerEvento,
    pareceAnuncioDeSorteo
};