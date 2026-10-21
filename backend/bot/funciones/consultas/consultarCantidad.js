const { consultarMisNumerosPorEstado } = require("./consultarMisNumeros");

// READ-ONLY. Compatibilidad: resolverConsulta.js ya no la usa (lee
// consultarMisNumerosPorEstado una sola vez); reutiliza esa misma lectura.
async function consultarCantidad({ evento, usuario }) {

    const { total } = await consultarMisNumerosPorEstado({ evento, usuario });

    return total;

}

module.exports = {
    consultarCantidad
};
