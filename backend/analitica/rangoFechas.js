// ==========================================================================
// Rangos de fecha del panel privado en la zona horaria del negocio
// (America/Bogota): "hoy" es el día de Colombia,
// no el día UTC del servidor.
//
//   preset=hoy | ayer | 7d | rango (&desde=YYYY-MM-DD&hasta=YYYY-MM-DD)
//
// Devuelve { desde, hasta } como Date UTC, intervalo [desde, hasta).
// ==========================================================================

const config = require("./config");

const MAX_DIAS_RANGO = 93;

const FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;

// Desfase (ms) de la zona respecto a UTC en un instante dado.
function desfaseMs(zona, instante) {

    const partes = new Intl.DateTimeFormat("en-US", {
        timeZone: zona,
        timeZoneName: "longOffset"
    }).formatToParts(instante);

    const nombre = partes.find(p => p.type === "timeZoneName")?.value || "GMT";
    const m = nombre.match(/GMT([+-])(\d{2}):(\d{2})/);

    if (!m) return 0;

    const signo = m[1] === "-" ? -1 : 1;
    return signo * (Number(m[2]) * 60 + Number(m[3])) * 60000;

}

// "Hoy" (año, mes, día) en la zona.
function hoyEnZona(zona, ahora) {

    const partes = Object.fromEntries(
        new Intl.DateTimeFormat("en-CA", {
            timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit"
        }).formatToParts(ahora).map(p => [p.type, p.value])
    );

    return { y: Number(partes.year), m: Number(partes.month), d: Number(partes.day) };

}

// Medianoche local de (y, m, d) expresada en UTC.
function medianoche(zona, y, m, d) {

    const utc = Date.UTC(y, m - 1, d);
    // Dos pasadas por si el día cruza un cambio de horario.
    const primera = utc - desfaseMs(zona, new Date(utc));
    return new Date(utc - desfaseMs(zona, new Date(primera)));

}

function sumarDias({ y, m, d }, dias) {
    const f = new Date(Date.UTC(y, m - 1, d + dias));
    return { y: f.getUTCFullYear(), m: f.getUTCMonth() + 1, d: f.getUTCDate() };
}

function parsearFecha(texto) {

    const m = FECHA.exec(String(texto || ""));
    if (!m) return null;

    const f = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
    const check = new Date(Date.UTC(f.y, f.m - 1, f.d));

    if (check.getUTCFullYear() !== f.y || check.getUTCMonth() !== f.m - 1 || check.getUTCDate() !== f.d) {
        return null;
    }

    return f;

}

function resolverRango({ preset, desde, hasta } = {}, ahora = new Date()) {

    const zona = config.ZONA_HORARIA;
    const hoy = hoyEnZona(zona, ahora);
    const dia = f => medianoche(zona, f.y, f.m, f.d);

    switch (preset || "hoy") {

        case "hoy":
            return { desde: dia(hoy), hasta: dia(sumarDias(hoy, 1)) };

        case "ayer":
            return { desde: dia(sumarDias(hoy, -1)), hasta: dia(hoy) };

        case "7d":
            return { desde: dia(sumarDias(hoy, -6)), hasta: dia(sumarDias(hoy, 1)) };

        case "rango": {

            const inicio = parsearFecha(desde);
            const fin = parsearFecha(hasta);

            if (!inicio || !fin) return null;

            const rDesde = dia(inicio);
            const rHasta = dia(sumarDias(fin, 1));

            if (rHasta <= rDesde) return null;
            if ((rHasta - rDesde) / 86400000 > MAX_DIAS_RANGO) return null;

            return { desde: rDesde, hasta: rHasta };

        }

        default:
            return null;

    }

}

module.exports = { resolverRango, MAX_DIAS_RANGO };
