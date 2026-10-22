const { parsearHora } = require("./normalizarAnuncio");

// "10:30 PM", "10:30 p. m.", "10:30pm", "10 PM", "10:30 de la noche" o
// "22:30" -> "22:30". Una hora sin am/pm que pueda ser de mañana o de noche
// ("10:30") no se adivina: null.
function extraerHoraEvento(lineaEvento = "") {

    return parsearHora(lineaEvento);

}

module.exports = {

    extraerHoraEvento

};
