const { normalizarTexto } = require("../../../utils/normalizarTexto");
const { LOTERIAS } = require("./loterias");

function buscarLineaEvento(texto = "") {

    const lineas = texto
        .split("\n")
        .map(l => l.trim())
        .filter(Boolean);

    for (const linea of lineas) {

        const normalizada = normalizarTexto(linea);

        // Debe contener una hora (10:30, 2:30, etc.)
        const tieneHora = /\b\d{1,2}:\d{2}\b/.test(normalizada);

        if (!tieneHora) {
            continue;
        }

        // Buscar cualquier lotería conocida
        for (const loteria of LOTERIAS) {

            const nombre = normalizarTexto(loteria);

            if (normalizada.includes(nombre)) {
                return linea;
            }

        }

        // Respaldo:
        // Si menciona "lotería" y tiene una hora,
        // probablemente es la línea del evento.
        if (normalizada.includes("loteria")) {
            return linea;
        }

    }

    return null;

}

module.exports = {
    buscarLineaEvento
};