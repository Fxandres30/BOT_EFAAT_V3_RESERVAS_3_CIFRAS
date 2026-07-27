const { normalizarTexto } = require("../../utils/normalizarTexto");

const PALABRAS_NO_PERMITIDAS = [
    "ok",
    "cancelo",
    "cancelar",
    "cancelado",
    "libero",
    "listo",
    "vale",
    "minutos",
    "mande",
    "querido",
    "pm",
    "hora",
    "horas",
    "mañana",
    "quedan",
    "personas",
    "dale",
    "de acuerdo",
    "perfecto",
    "familia",
    "consignar",
    "confirmado",
    "gana",
    "premio",
    "sorteo",
    "nequi",
    "pago",
    "pague",
    "pagado",
    "reservado",
    "reservar",
    "reservados",
    "tengo",
    "estaba",
    "solo",
    "ultimos",
    "cariño",
    "grupo",
    "persona",
    "numeritos",
    "todos",
    "envio",
    "sociedad",
    "sociedades",
    "mitad"
];

const EMOJIS_NO_PERMITIDOS = [
    "❌",
    "✅",
    "✨",
    "🚨",
    "📊",
    "🔥",
    "☀️",
    "🌅",
    "🌆",
    "🌙",
    "🎯",
    "💰",
    "👀",
    "🤝",
    "🚫",
    "📭",
    "🚀"
];

function validarTextoReserva(texto = "") {

    for (const emoji of EMOJIS_NO_PERMITIDOS) {
        if (texto.includes(emoji)) {
            return false;
        }
    }

    const limpio = normalizarTexto(texto);

    for (const palabra of PALABRAS_NO_PERMITIDAS) {
        if (limpio.includes(palabra)) {
            return false;
        }
    }

    return true;
}

module.exports = {
    validarTextoReserva
};