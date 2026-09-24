// ==========================================================================
// Clasificación de dispositivo / sistema operativo / navegador a partir
// del User-Agent REAL de la petición (cabecera HTTP, no un campo del body).
// Sin dependencias: solo reconoce lo necesario para el panel privado.
//
// `tactil` (navigator.maxTouchPoints, validado) solo se usa para una cosa:
// iPadOS se presenta como "Macintosh" — un Mac con pantalla táctil es un
// iPad.
//
// Devuelve null para bots / navegadores automatizados (Puppeteer de
// compartirTabla.js, crawlers, previews de enlaces): no son visitas.
// ==========================================================================

const BOT = /bot\b|crawl|spider|slurp|headless|puppeteer|playwright|phantomjs|selenium|lighthouse|pagespeed|facebookexternalhit|whatsapp|telegrambot|preview|curl\/|wget\/|python-requests|node-fetch|axios\//i;

function version(ua, regex) {
    const m = ua.match(regex);
    return m ? m[1].replace(/_/g, ".") : "";
}

function conVersion(nombre, v) {
    return v ? `${nombre} ${v}` : nombre;
}

function sistemaOperativo(ua, esIpad) {

    if (/Windows Phone/i.test(ua)) return "Windows Phone";
    if (/Android/i.test(ua)) return conVersion("Android", version(ua, /Android (\d+(?:\.\d+)?)/i));
    if (/iPad/i.test(ua) || esIpad) return conVersion("iPadOS", version(ua, /OS (\d+(?:_\d+)?)/i));
    if (/iPhone|iPod/i.test(ua)) return conVersion("iOS", version(ua, /OS (\d+(?:_\d+)?)/i));
    if (/CrOS/i.test(ua)) return "ChromeOS";
    // Windows 10 y 11 envían el mismo "Windows NT 10.0": no se distinguen.
    if (/Windows NT 10/i.test(ua)) return "Windows";
    if (/Windows NT 6\.3/i.test(ua)) return "Windows 8.1";
    if (/Windows NT 6\.1/i.test(ua)) return "Windows 7";
    if (/Windows/i.test(ua)) return "Windows";
    if (/Mac OS X|Macintosh/i.test(ua)) return "macOS";
    if (/Linux/i.test(ua)) return "Linux";
    return null;

}

function navegador(ua) {

    // El orden importa: Edge/Opera/Samsung incluyen "Chrome" en su UA,
    // y Chrome incluye "Safari".
    const reglas = [
        ["Edge", /Edg(?:e|A|iOS)?\/(\d+)/],
        ["Opera", /(?:OPR|Opera)\/(\d+)/],
        ["Samsung Internet", /SamsungBrowser\/(\d+)/],
        ["Firefox", /(?:Firefox|FxiOS)\/(\d+)/],
        ["Chrome", /(?:Chrome|CriOS)\/(\d+)/],
        ["Safari", /Version\/(\d+)(?:\.\d+)*.*Safari/]
    ];

    for (const [nombre, regex] of reglas) {
        const m = ua.match(regex);
        if (m) return `${nombre} ${m[1]}`;
    }

    return null;

}

function parsearUserAgent(userAgent, tactil = 0) {

    const ua = String(userAgent || "").slice(0, 512);

    if (!ua || BOT.test(ua)) return null;

    const esIpad = /Macintosh/i.test(ua) && Number(tactil) > 1;

    let deviceType = "unknown";

    if (/iPad|Tablet|PlayBook|Silk|Kindle/i.test(ua) || esIpad || (/Android/i.test(ua) && !/Mobile/i.test(ua))) {
        deviceType = "tablet";
    } else if (/Mobi|iPhone|iPod|Windows Phone/i.test(ua)) {
        deviceType = "mobile";
    } else if (/Windows NT|Macintosh|X11|Linux|CrOS/i.test(ua)) {
        deviceType = "desktop";
    }

    return {
        deviceType,
        operatingSystem: sistemaOperativo(ua, esIpad),
        browser: navegador(ua)
    };

}

module.exports = { parsearUserAgent };
