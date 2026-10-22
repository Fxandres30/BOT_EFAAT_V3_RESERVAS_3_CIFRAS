// ==========================================================================
// normalizarAnuncio.js — piezas comunes para leer anuncios de sorteo
// escritos de formas distintas (emojis, asteriscos, flechas, acentos,
// mayúsculas, "10:30 PM" / "10:30 p. m." / "22:30", "$95.000" / "95000
// pesos"...). Solo interpreta texto: no decide si el mensaje es un anuncio
// (eso lo hace extraerEvento.js) ni inventa ningún dato que no esté escrito.
// ==========================================================================

function quitarTildes(texto = "") {
    return String(texto ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Líneas no vacías, sin importar si el mensaje llegó con \r\n.
function lineasDe(texto = "") {
    return String(texto ?? "")
        .split(/\r?\n|\r/)
        .map(l => l.trim())
        .filter(Boolean);
}

// Texto visible de una línea sin decoración: emojis (con sus selectores de
// variación y uniones), asteriscos/guiones bajos de formato de WhatsApp y
// viñetas o flechas (✧ ➜ → • ►...). Conserva mayúsculas, acentos y "+".
function limpiarDecoracion(linea = "") {
    return String(linea ?? "")
        .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}️‍⃣]/gu, " ")
        .replace(/[*_~`]/g, " ")
        .replace(/[✧✦✩✪★☆•·▪▫►▶➜➔➡→⇒⟶➤»«|]/g, " ")
        .replace(/=>|->/g, " ")
        .replace(/^[\s:.,;–—-]+|[\s:.,;–—-]+$/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

// ----------------------------------------------------------------- horas ---

// "pm" / "p.m." / "p. m." (también con el espacio estrecho que usa es-CO).
const SUFIJO = "([ap])\\s*\\.?\\s*m(?![a-z])\\.?";
const HORA_MINUTOS_SUFIJO = new RegExp(`(?<![\\d.,:$])(\\d{1,2})\\s*[:.h]\\s*([0-5]\\d)\\s*${SUFIJO}`);
const HORA_SOLA_SUFIJO = new RegExp(`(?<![\\d.,:$])(\\d{1,2})\\s*${SUFIJO}`);
const HORA_DE_LA = /(?<![\d.,:$])(\d{1,2})(?:\s*[:.h]\s*([0-5]\d))?\s+de\s+la\s+(manana|tarde|noche)\b/;
const HORA_24 = /(?<![\d.,:$])([01]?\d|2[0-3])\s*[:h]\s*([0-5]\d)(?!\d)/;

function formato(hora, minuto) {
    return `${String(hora).padStart(2, "0")}:${minuto}`;
}

function a24(hora, minuto, periodo) {

    // "22:30 pm": la hora ya viene en 24 h.
    if (hora >= 13 && hora <= 23) return formato(hora, minuto);

    if (hora < 1 || hora > 12) return null;

    if (periodo === "p" && hora !== 12) hora += 12;
    if (periodo === "a" && hora === 12) hora = 0;

    return formato(hora, minuto);

}

// Primera hora escrita en la línea, como "HH:MM" en 24 h, o null. Una hora
// sin am/pm solo se acepta si no es ambigua (13:00-23:59 o 00:xx): "10:30" a
// secas puede ser de mañana o de noche y no se adivina.
function parsearHora(linea = "") {

    const t = quitarTildes(String(linea ?? "").toLowerCase()).replace(/[*_~]/g, " ");

    let m = t.match(HORA_MINUTOS_SUFIJO);
    if (m) return a24(Number(m[1]), m[2], m[3]);

    m = t.match(HORA_SOLA_SUFIJO);
    if (m) return a24(Number(m[1]), "00", m[2]);

    m = t.match(HORA_DE_LA);
    if (m) return a24(Number(m[1]), m[2] || "00", m[3] === "manana" ? "a" : "p");

    m = t.match(HORA_24);
    if (m && (Number(m[1]) >= 13 || Number(m[1]) === 0)) return formato(Number(m[1]), m[2]);

    return null;

}

// --------------------------------------------------------------- montos ---

const MONTOS = [
    // $95.000 · $95000 · $ 2,000 · $20 mil
    /\$\s*(\d{1,3}(?:[.,]\d{3})+|\d+)(?:\s*(mil|k)\b)?/g,
    // 95000 pesos · 95.000 COP · 20 mil · 20k
    /(?<![\d.,$])(\d{1,3}(?:[.,]\d{3})+|\d+)\s*(mil|k|pesos|cop)\b/g,
    // 95.000 (separador de miles, sin símbolo)
    /(?<![\d.,:$])(\d{1,3}(?:[.,]\d{3})+)(?![\d:]|[.,]\d)/g
];

// Montos de dinero de un texto, en orden de aparición: [{ valor, indice, fin }]
// (índices sobre el mismo texto recibido). Un teléfono (3246303190) o una
// hora (10:30) no son montos.
function montosEn(texto = "") {

    const t = String(texto ?? "").toLowerCase();
    const encontrados = [];

    for (const patron of MONTOS) {

        patron.lastIndex = 0;

        for (const m of t.matchAll(patron)) {

            const base = Number(m[1].replace(/[.,]/g, ""));
            const multiplicador = m[2] === "mil" || m[2] === "k" ? 1000 : 1;
            const valor = base * multiplicador;

            if (!Number.isFinite(valor) || valor <= 0) continue;

            const indice = m.index;
            const fin = m.index + m[0].length;

            // El mismo monto ya visto por un patrón anterior.
            if (encontrados.some(e => indice < e.fin && fin > e.indice)) continue;

            encontrados.push({ valor, indice, fin });

        }

    }

    return encontrados.sort((a, b) => a.indice - b.indice);

}

// La línea sin sus montos (para quedarse con la etiqueta del premio).
function quitarMontos(texto = "") {

    let resultado = String(texto ?? "");

    for (const m of montosEn(resultado).reverse()) {
        resultado = resultado.slice(0, m.indice) + " " + resultado.slice(m.fin);
    }

    return resultado;

}

module.exports = {
    quitarTildes,
    lineasDe,
    limpiarDecoracion,
    parsearHora,
    montosEn,
    quitarMontos
};
