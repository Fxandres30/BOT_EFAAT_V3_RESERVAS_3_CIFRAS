const { buscarLineaEvento, buscarLineaLoteria, buscarHoraEtiquetada } = require("./buscarLineaEvento");
const { extraerNombreEvento } = require("./extraerNombreEvento");
const { extraerHoraEvento } = require("./extraerHoraEvento");
const { extraerHoraLiberacion } = require("./extraerHoraLiberacion");
const { extraerValorNumero } = require("./extraerValorNumero");
const { extraerPremios } = require("./extraerPremios");
const { calcularCierre } = require("./calcularCierre");

module.exports = {

    buscarLineaEvento,

    buscarLineaLoteria,

    buscarHoraEtiquetada,

    extraerNombreEvento,

    extraerHoraEvento,

    extraerHoraLiberacion,

    extraerValorNumero,

    extraerPremios,

    calcularCierre

};
