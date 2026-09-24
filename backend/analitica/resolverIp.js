// ==========================================================================
// IP del visitante, sin configuración.
//
// Se toma la ÚLTIMA entrada de X-Forwarded-For tal como llegó a Next:
//   - sin proxy delante, Next la rellena con la IP del socket;
//   - con nginx ($proxy_add_x_forwarded_for) la última entrada es la que
//     añadió nginx con la IP real de conexión — lo que el cliente haya
//     escrito queda a la izquierda y se ignora.
//
// Limitación conocida: si Next está expuesto SIN proxy y el cliente envía
// su propio X-Forwarded-For, Next lo conserva y la IP de ESE visitante
// queda falseada (solo afecta a su propio registro). Es un dato
// informativo, igual que el user-agent.
// ==========================================================================

const net = require("net");

function limpiar(valor) {

    if (typeof valor !== "string") return null;

    let ip = valor.trim();

    // "[2800::1]:443" / "190.1.2.3:5123" -> sin puerto
    const corchetes = ip.match(/^\[([^\]]+)\](?::\d+)?$/);
    if (corchetes) ip = corchetes[1];
    else if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(ip)) ip = ip.split(":")[0];

    // IPv4 mapeada en IPv6 (::ffff:190.1.2.3)
    const mapeada = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (mapeada) ip = mapeada[1];

    return net.isIP(ip) ? ip : null;

}

function resolverIp(xForwardedFor) {

    if (typeof xForwardedFor !== "string" || xForwardedFor.length > 1024) return null;

    const entradas = xForwardedFor.split(",").map(e => e.trim()).filter(Boolean);

    return entradas.length ? limpiar(entradas[entradas.length - 1]) : null;

}

module.exports = { resolverIp, limpiar };
