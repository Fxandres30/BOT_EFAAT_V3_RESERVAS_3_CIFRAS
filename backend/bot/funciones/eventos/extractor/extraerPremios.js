function extraerPremios(texto = "") {

    const premios = [];

    const lineas = texto
        .split("\n")
        .map(l => l.trim())
        .filter(Boolean);

    let esBono = false;

    for (const linea of lineas) {

        const l = linea.toLowerCase();

        // Comienza la sección de bonos
        if (l.includes("bono")) {

            esBono = true;
            continue;

        }

        // Finaliza la sección de premios
        if (

            l.includes("valor número") ||
            l.includes("valor numero") ||
            l.includes("liberado") ||
            l.includes("recuerde familia") ||
            l.includes("nequi") ||
            l.includes("daviplata") ||
            l.includes("bre") ||
            l.includes("301") ||
            l.includes("302") ||
            l.includes("303")

        ) {

            esBono = false;
            continue;

        }

        // Solo aceptar líneas que realmente sean premios
        if (
            !linea.includes("🍀") &&
            !linea.includes("🪎")
        ) {
            continue;
        }

        const match = linea.match(
            /(.+?)\s*(?:→|-|:)\s*\*?\$?\s*([\d.,]+)\*?/i
        );

        if (!match)
            continue;

        let nombre = match[1]

            .replace("🍀", "")
            .replace("🪎", "")
            .trim();

        const premio = Number(
            match[2].replace(/[.,]/g, "")
        );

        let tipo = "otro";

        const n = nombre.toLowerCase();

        if (esBono) {

            tipo = "bono";

        } else if (
            n.includes("dos últimas") ||
            n.includes("dos ultimas")
        ) {

            tipo = "dos_ultimas_cifras";

        } else if (
            n.includes("dos primeras")
        ) {

            tipo = "dos_primeras_cifras";

        } else if (
            n.includes("centro")
        ) {

            tipo = "dos_centro";

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