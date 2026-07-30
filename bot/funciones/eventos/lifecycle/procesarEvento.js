const { evaluarEvento } = require("./evaluarEvento");
const { cerrarEvento } = require("./cerrarEvento");

async function procesarEvento({

    sock,
    evento

}) {

    const resultado = await evaluarEvento(evento);

    if (!resultado)
        return false;

    switch (resultado.accion) {

        case "continuar":

            return false;

        case "cerrar":

            console.log("🔒 Cerrando evento...");
            console.log(resultado.motivo);

            await cerrarEvento({

                sock,
                evento,
                motivo: resultado.motivo

            });

            return true;

        default:

            return false;

    }

}

module.exports = {
    procesarEvento
};