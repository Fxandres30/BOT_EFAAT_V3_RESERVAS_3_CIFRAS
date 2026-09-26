// ==========================================================================
// Ubicación APROXIMADA del visitante (nivel ciudad), SOLO a partir de las
// cabeceras que añade un CDN delante del servidor. Sin servicios externos,
// sin GPS, sin geolocalización del navegador, sin coordenadas.
//
//   Cloudflare  cf-ipcountry            código ISO de país (siempre)
//               cf-region / cf-region-code / cf-ipcity
//                                       solo con "Add visitor location
//                                       headers" (Managed Transforms)
//   Vercel      x-vercel-ip-country / x-vercel-ip-country-region /
//               x-vercel-ip-city (URL-encoded)
//
// Si no hay CDN (infraestructura actual: VPS sin proxy geográfico) no llega
// ninguna de estas cabeceras y todo queda en null: nunca se inventa.
//
// Limitación: igual que la IP, si el servidor queda expuesto sin CDN un
// cliente podría enviar estas cabeceras a mano y falsear la ubicación de
// SU propio registro. Es un dato informativo.
// ==========================================================================

const CABECERAS = [
    "cf-ipcountry", "cf-region", "cf-region-code", "cf-ipcity",
    "x-vercel-ip-country", "x-vercel-ip-country-region", "x-vercel-ip-city"
];

const nombresPais = new Intl.DisplayNames(["es"], { type: "region" });

function texto(valor, max = 100) {

    if (typeof valor !== "string") return null;

    let t = valor;

    // Vercel codifica la ciudad con encodeURIComponent ("Bogot%C3%A1").
    if (/%[0-9a-f]{2}/i.test(t)) {
        try {
            t = decodeURIComponent(t);
        } catch {
            return null;
        }
    }

    t = t.replace(/[\u0000-\u001f\u007f]/g, "").trim();

    return t && t.length <= max ? t : null;

}

function codigoPais(valor) {

    const c = texto(valor, 2)?.toUpperCase();

    // XX = desconocido, T1 = Tor (Cloudflare).
    if (!c || !/^[A-Z]{2}$/.test(c) || c === "XX" || c === "T1") return null;

    return c;

}

function nombrePais(codigo) {

    if (!codigo) return null;

    try {
        const nombre = nombresPais.of(codigo);
        return nombre && nombre !== codigo ? nombre : null;
    } catch {
        return null;
    }

}

// `geo`: objeto { cabecera: valor } que reenvía la ruta de Next con las
// cabeceras de la petición del navegador (solo las de la lista de arriba).
function ubicacionAproximada(geo) {

    const vacia = { country: null, region: null, city: null, countryCode: null };

    if (!geo || typeof geo !== "object") return vacia;

    const esCloudflare = typeof geo["cf-ipcountry"] === "string";
    const esVercel = !esCloudflare && typeof geo["x-vercel-ip-country"] === "string";

    if (!esCloudflare && !esVercel) return vacia;

    const countryCode = codigoPais(esCloudflare ? geo["cf-ipcountry"] : geo["x-vercel-ip-country"]);

    const region = esCloudflare
        ? texto(geo["cf-region"]) || texto(geo["cf-region-code"], 10)
        : texto(geo["x-vercel-ip-country-region"], 10);

    const city = texto(esCloudflare ? geo["cf-ipcity"] : geo["x-vercel-ip-city"]);

    // Sin país fiable no se guarda nada (una ciudad sin país no se puede validar).
    if (!countryCode) return vacia;

    return { country: nombrePais(countryCode), region, city, countryCode };

}

module.exports = { ubicacionAproximada, CABECERAS_GEO: CABECERAS };
