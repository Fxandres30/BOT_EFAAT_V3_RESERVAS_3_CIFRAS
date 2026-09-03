const { buscarLineaEvento } = require("./buscarLineaEvento");
const { extraerNombreEvento } = require("./extraerNombreEvento");
const { extraerHoraEvento } = require("./extraerHoraEvento");
const { extraerHoraLiberacion } = require("./extraerHoraLiberacion");
const { extraerValorNumero } = require("./extraerValorNumero");
const { extraerPremios } = require("./extraerPremios");
const { calcularCierre } = require("./calcularCierre");

module.exports = {

    buscarLineaEvento,

    extraerNombreEvento,

    extraerHoraEvento,

    extraerHoraLiberacion,

    extraerValorNumero,

    extraerPremios,

    calcularCierre

};