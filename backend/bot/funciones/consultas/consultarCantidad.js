const { consultarMisNumeros } = require("./consultarMisNumeros");

// READ-ONLY. Reutiliza consultarMisNumeros para no duplicar la consulta.
async function consultarCantidad({ evento, usuario }) {

    const numeros = await consultarMisNumeros({ evento, usuario });

    return numeros.length;

}

module.exports = {
    consultarCantidad
};
