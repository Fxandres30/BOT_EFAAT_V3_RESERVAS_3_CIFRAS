const {
    buscarLineaEvento,
    buscarLineaLoteria,
    buscarHoraEtiquetada,
    extraerNombreEvento,
    extraerHoraEvento,
    extraerHoraLiberacion,
    extraerValorNumero,
    extraerPremios,
    calcularCierre
} = require("./extractor");
const { normalizarTexto } = require("../../utils/normalizarTexto");
const { obtenerConfiguracion } = require("./configEvento");

// "Para hoy", "mañana", "22 de octubre": el anuncio dice para cuándo es.
// Solo cuenta como señal de anuncio; la fecha del sorteo la sigue calculando
// fechaSorteoAnunciado() a partir de la hora.
const MENCION_FECHA = /\bhoy\b|\bmanana\b|\b\d{1,2}\s+de\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b/;

// Anuncio de sorteo escrito en el texto, o null si no lo es.
//
// Dos formatos (y sus variantes de emojis, mayúsculas, acentos y saltos de
// línea):
//   - clásico: lotería y hora en la MISMA línea ("🎰 Lotería de Bogotá -
//     10:30 PM"); se reconoce como siempre;
//   - en varias líneas: la lotería en una ("*LOTERÍA DE BOGOTÁ* 🍀") y la
//     hora en otra con etiqueta ("⌛ HORA ESTIMADA: 10:30 PM"). Como no hay
//     línea de evento, se exigen señales suficientes: lotería + (hora o
//     fecha) + (premios o valor por número). Mencionar una lotería no basta.
//
// Lo que no está escrito no se inventa: si falta la hora o el valor del
// número, el evento se devuelve con `faltantes` (["hora"], ["valor"]) y
// detectarEvento no lo guarda.
function extraerEvento(texto = "") {

    const lineaEvento = buscarLineaEvento(texto);
    const lineaNombre = lineaEvento || buscarLineaLoteria(texto);

    if (!lineaNombre) {
        return null;
    }

    const nombre = extraerNombreEvento(lineaNombre);
    const hora = extraerHoraEvento(lineaNombre) || buscarHoraEtiquetada(texto);
    const horaLiberacion = extraerHoraLiberacion(texto);
    const valor = extraerValorNumero(texto);
    const premios = extraerPremios(texto);

    if (!lineaEvento) {

        const conFecha = MENCION_FECHA.test(normalizarTexto(texto));

        if (!((hora || conFecha) && (valor || premios.length))) {
            return null;
        }

    }

    const faltantes = [];

    if (!nombre) faltantes.push("nombre");
    if (!hora) faltantes.push("hora");
    if (!valor) faltantes.push("valor");

    return {

        nombre: nombre || null,

        hora: hora || null,

        horaCierre: hora
            ? calcularCierre(hora)
            : null,

        horaLiberacion: horaLiberacion || null,

        valor: valor || null,

        premios,

        faltantes

    };

}

// ¿El texto tiene forma de ANUNCIO de sorteo? Mismo criterio con el que
// detectarEvento.js acepta un anuncio: lotería + hora (en la misma línea o
// en una línea con etiqueta) y un precio con configuración real
// (configEvento.js). Lo usa eventHandler.js para no interpretar además ese
// mismo mensaje como consulta o reserva de un cliente (la hora "10:40" o
// "Números disponibles" de un anuncio no son un pedido).
function pareceAnuncioDeSorteo(texto = "") {

    const evento = extraerEvento(texto);

    return !!evento && !!obtenerConfiguracion(evento.valor) && (!!evento.hora || !!buscarLineaEvento(texto));

}

module.exports = {
    extraerEvento,
    pareceAnuncioDeSorteo
};
