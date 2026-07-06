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

    const match = limpio.match(/(\d{1,2})\s?(\d{2})\s?(am|pm)/i);

    if (!match)
        return null;

    let [, h, m, periodo] = match;

    h = parseInt(h);

    if (periodo === "pm" && h !== 12)
        h += 12;

    if (periodo === "am" && h === 12)
        h = 0;

    const hora = `${String(h).padStart(2, "0")}:${m}`;

    const horaCierre = calcularCierre(hora);

    const limpioTexto = normalizarTexto(texto);

    const lineaHora =
        texto.split("\n").find(l => /am|pm/i.test(l)) || "";

    const limpioNombre =
        normalizarTexto(lineaHora)
            .replace(/\d{1,2}\s?\d{2}\s?(am|pm)/i, "")
            .trim();

    const nombre =
        limpioNombre
            .split(" ")
            .map(p => p.charAt(0).toUpperCase() + p.slice(1))
            .join(" ") || "Evento";

    const valorMatch =
        limpioTexto.match(/valor\s*(numero)?\s*([\d\s]+)/i);

    let valor = "No definido";

    if (valorMatch) {

        valor = `$${valorMatch[2].replace(/\s+/g, "")}`;

    }

    const premios =
        texto
            .split("\n")
            .map(l => l.trim())
            .filter(l => {

                const n = normalizarTexto(l);

                return /\d{3,}/.test(n) && !n.includes("valor");

            });

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