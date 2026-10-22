const { normalizarTexto } = require("../../../utils/normalizarTexto");
const { LOTERIAS } = require("./loterias");
const { lineasDe, parsearHora } = require("./normalizarAnuncio");
const { loteriaTradicional } = require("./extraerNombreEvento");

// ¿La línea (ya normalizada) nombra una lotería?
function nombraLoteria(normalizada) {

    // Buscar cualquier lotería conocida
    for (const loteria of LOTERIAS) {

        if (normalizada.includes(normalizarTexto(loteria))) {
            return true;
        }

    }

    if (loteriaTradicional(normalizada)) {
        return true;
    }

    // Respaldo:
    // Si menciona "lotería", probablemente es la línea del evento.
    return normalizada.includes("loteria");

}

// Formato clásico: la lotería y la hora en la MISMA línea
// ("🎰 Lotería de Bogotá - 10:30 PM").
function buscarLineaEvento(texto = "") {

    for (const linea of lineasDe(texto)) {

        const normalizada = normalizarTexto(linea);

        // Debe contener una hora (10:30, 2:30, etc.)
        const tieneHora = /\b\d{1,2}:\d{2}\b/.test(normalizada);

        if (!tieneHora) {
            continue;
        }

        if (nombraLoteria(normalizada)) {
            return linea;
        }

    }

    return null;

}

// Formato en varias líneas: la primera línea que nombra una lotería, tenga
// o no la hora ("*LOTERÍA DE BOGOTÁ* 🍀").
function buscarLineaLoteria(texto = "") {

    return lineasDe(texto).find(linea => nombraLoteria(normalizarTexto(linea))) || null;

}

// Hora del sorteo escrita en su propia línea con una etiqueta ("⌛ HORA
// ESTIMADA: 10:30 PM", "Juega a las 10:30 p. m."). Nunca la de liberación
// ni la de cierre de reservas, ni una hora suelta sin etiqueta (p. ej. la de
// un recordatorio de pago).
function buscarHoraEtiquetada(texto = "") {

    for (const linea of lineasDe(texto)) {

        const normalizada = normalizarTexto(linea);

        if (/liberad|cierr|pagar|pago/.test(normalizada)) continue;

        if (!/\bhora\b|\bhorario\b|\bjuega\b|\bjuego\b|\bsorteo\b|\ba las\b/.test(normalizada)) continue;

        const hora = parsearHora(linea);

        if (hora) return hora;

    }

    return null;

}

module.exports = {
    buscarLineaEvento,
    buscarLineaLoteria,
    buscarHoraEtiquetada
};
