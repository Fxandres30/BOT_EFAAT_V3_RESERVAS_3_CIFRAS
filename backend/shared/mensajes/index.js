// ==========================================================================
// shared/mensajes — núcleo del ORQUESTADOR CENTRAL DE MENSAJES (fase O1).
//
// AISLADO: ningún motor lo usa todavía (O2 empezará por Inicio del día, en
// modo sombra). Este directorio no importa nada de bot/, automation/,
// sorteos/ ni services/: lo comprueba tests/mensajes-o1.
// ==========================================================================

"use strict";

const { crearOrquestador, comparar } = require("./orquestador");
const catalogo = require("./catalogoTipos");
const modos = require("./modos");
const { seleccionar } = require("./etapas/seleccion");
const { validarContenido, validarSolicitud } = require("./etapas/validacion");
const { crearGuardianMemoria } = require("./etapas/envioUnico");
const { crearRegistroMemoria, registroNulo } = require("./etapas/registro");

module.exports = {
    crearOrquestador,
    comparar,
    catalogo,
    modos,
    seleccionar,
    validarContenido,
    validarSolicitud,
    crearGuardianMemoria,
    crearRegistroMemoria,
    registroNulo
};
