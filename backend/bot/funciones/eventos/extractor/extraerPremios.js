const { normalizarTexto } = require("../../../utils/normalizarTexto");
const { lineasDe, limpiarDecoracion, montosEn, quitarMontos } = require("./normalizarAnuncio");

// Tipo de un premio por su etiqueta (ya normalizada), o null si no es una
// etiqueta conocida. «Primera + última cifra» es un premio ADICIONAL: se
// mira antes que «últimas» para no confundirlo con el de las dos últimas.
function tipoPorEtiqueta(n = "") {

    if (/\bprimera\s+(?:(?:y|mas|con|la)\s+)*ultima\b|\bultima\s+(?:(?:y|mas|con|la)\s+)*primera\b/.test(n)) return "bono";

    if (/\bultimas\b|\bfinales\b/.test(n)) return "dos_ultimas_cifras";

    if (/\bprimeras\b|\biniciales\b/.test(n)) return "dos_primeras_cifras";

    if (/\bcentro\b|\bcentrales\b|\bdel medio\b/.test(n)) return "dos_centro";

    return null;

}

// Líneas que cierran la lista de premios (precio del número, medios de
// pago, liberación...). Las del formato de siempre, más las equivalentes de
// otros formatos.
function cierraPremios(l, n) {

    return (

        l.includes("valor número") ||
        l.includes("valor numero") ||
        l.includes("liberado") ||
        l.includes("recuerde familia") ||
        l.includes("nequi") ||
        l.includes("daviplata") ||
        l.includes("bre") ||
        l.includes("301") ||
        l.includes("302") ||
        l.includes("303") ||

        /participacion|valor (?:(?:por|x|del|de cada) )?numero|valor (?:de la )?boleta|medio habilitado|medios? de pago|cada numero|liberado|nequi|daviplata/.test(n)

    );

}

function extraerPremios(texto = "") {

    const premios = [];

    let esBono = false;

    // Debajo de un encabezado "PREMIOS" (formato en el que el monto va antes
    // de la etiqueta: "✧ $95.000 ➜ Cifras finales").
    let enPremios = false;

    for (const linea of lineasDe(texto)) {

        const l = linea.toLowerCase();
        const n = normalizarTexto(linea);
        const montos = montosEn(linea);

        // Comienza la sección de bonos
        if (l.includes("bono")) {

            esBono = true;

            // "BONO $20.000" en la misma línea: también es un premio.
            if (montos.length) {
                premios.push({ tipo: "bono", nombre: limpiarDecoracion(quitarMontos(linea)) || "Bono", premio: montos[0].valor });
            }

            continue;

        }

        // "💎 ACUMULADO $300.000": premio que se suma, no uno principal.
        if (/\bacumulad/.test(n) && montos.length) {

            premios.push({ tipo: "otro", nombre: "Acumulado", premio: montos[0].valor });
            continue;

        }

        // Finaliza la sección de premios
        if (cierraPremios(l, n)) {

            esBono = false;
            enPremios = false;
            continue;

        }

        // Encabezado de la lista ("🏆 PREMIOS 🏆").
        if (/\bpremios?\b/.test(n) && !montos.length) {

            enPremios = true;
            continue;

        }

        // Formato de siempre: "🍀 Dos últimas cifras → $95.000".
        const conTrebol = linea.includes("🍀") || linea.includes("🪎");

        const match = conTrebol && linea.match(
            /(.+?)\s*(?:→|-|:)\s*\*?\$?\s*([\d.,]+)\*?/i
        );

        let nombre;
        let premio;

        if (match) {

            nombre = match[1]

                .replace("🍀", "")
                .replace("🪎", "")
                .replace(/\s+/g, " ")
                .trim();

            premio = Number(
                match[2].replace(/[.,]/g, "")
            );

        } else {

            // Otros formatos: un monto y una etiqueta de premio, o cualquier
            // línea con monto dentro de las secciones de premios o bonos.
            if (!montos.length) continue;

            const etiqueta = tipoPorEtiqueta(n);

            if (!etiqueta && !esBono && !enPremios) continue;

            nombre = limpiarDecoracion(quitarMontos(linea));
            premio = montos[0].valor;

            if (!nombre) continue;

        }

        let tipo = "otro";

        if (esBono) {

            tipo = "bono";

        } else {

            tipo = tipoPorEtiqueta(normalizarTexto(nombre)) || "otro";

        }

        premios.push({

            tipo,

            nombre,

            premio

        });

    }

    return premios;

}

module.exports = {

    extraerPremios

};
