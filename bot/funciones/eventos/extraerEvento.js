const { normalizarTexto } = require("../../utils/normalizarTexto");

function calcularCierre(horaFin) {

    const [h, m] = horaFin.split(":").map(Number);

    const fecha = new Date();

    fecha.setHours(h, m, 0, 0);

    const cierre = new Date(fecha.getTime() - (5 * 60 * 1000));

    return `${String(cierre.getHours()).padStart(2, "0")}:${String(cierre.getMinutes()).padStart(2, "0")}`;

}

function extraerEventos(texto) {

    if (!texto) return null;

    const limpio = normalizarTexto(texto);

    const palabrasClave = [
        "loter",
        "antioque",
        "sinuano",
        "chance",
        "astro",
        "paisita",
        "cafetero",
        "caribe",
        "dorado",
        "superastro",
        "chontico"
    ];

    if (!palabrasClave.some(p => limpio.includes(p)))
        return null;

    // Busca la línea de la lotería
    const lineaEvento = texto
        .split("\n")
        .find(l => l.includes("🎰"));

    if (!lineaEvento)
        return null;

    // Antioqueñita Tarde - 04:00 pm
    const eventoMatch = lineaEvento.match(/\*?(.+?)\s*-\s*(\d{1,2}):(\d{2})\s*(am|pm)/i);

    if (!eventoMatch)
        return null;

    let [, nombre, h, m, periodo] = eventoMatch;

    h = parseInt(h);

    if (periodo.toLowerCase() === "pm" && h !== 12)
        h += 12;

    if (periodo.toLowerCase() === "am" && h === 12)
        h = 0;

    const hora = `${String(h).padStart(2, "0")}:${m}`;

    const horaCierre = calcularCierre(hora);

    nombre = nombre
        .replace(/[🎰*]/g, "")
        .trim();

    const valorMatch = texto.match(
        /valor\s*n[uú]mero\s*:\s*\*?\$?([\d.]+)/i
    );

    let valor = "$0";

    if (valorMatch) {

        valor = "$" + valorMatch[1].replace(/\./g, "");

    }

    const premios = texto
        .split("\n")
        .filter(l => l.includes("🍀") || l.includes("🎁"))
        .map(l => l.trim());

    return {

        nombre,

        hora,

        horaCierre,

        valor,

        premios

    };

}

module.exports = {

    extraerEventos,

    calcularCierre

};