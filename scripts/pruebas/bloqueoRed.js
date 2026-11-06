// ==========================================================================
// scripts/pruebas/bloqueoRed.js: segunda barrera de las pruebas.
//
// El ejecutor (ejecutar.js) lo precarga en cada proceso de prueba con
// `node -r`. Bloquea cualquier conexión de red que no vaya a la propia
// máquina (127.0.0.1, ::1, localhost o un socket local). Así una prueba no
// puede llegar a Supabase, WhatsApp, Gemini ni ningún otro servicio aunque
// alguna salvaguarda anterior fallara (EFAAT_PRUEBAS=1, Supabase falso).
//
// Cada intento bloqueado se escribe en stderr con la marca [BLOQUEO RED].
// El ejecutor la busca y cuenta la prueba como fallida: una prueba que
// intenta salir de la máquina es un defecto, aunque sus asserts pasen.
// ==========================================================================

"use strict";

const net = require("net");
const dns = require("dns");

const MARCA = "[BLOQUEO RED]";
const LOCALES = new Set(["127.0.0.1", "::1", "localhost", "0.0.0.0", "::", "::ffff:127.0.0.1"]);

function esLocal(host) {
    if (host === undefined || host === null || host === "") return true; // por defecto Node usa localhost
    const h = String(host).toLowerCase().replace(/^\[|\]$/g, "");
    return LOCALES.has(h) || h.startsWith("127.") || h.endsWith(".localhost");
}

function avisar(destino) {
    // Sin stack completo: basta con saber a dónde intentó ir y desde dónde.
    const origen = (new Error().stack || "").split("\n").slice(3, 6).map(l => l.trim()).join(" <- ");
    process.stderr.write(`${MARCA} conexión a ${destino} bloqueada por el ejecutor de pruebas (${origen})\n`);
}

function errorBloqueo(destino) {
    const err = new Error(`${MARCA} conexión a ${destino} no permitida durante las pruebas`);
    err.code = "EFAAT_RED_BLOQUEADA";
    return err;
}

// net.Socket#connect es el paso común de net.connect, tls.connect, http(s)
// y fetch (undici). Se intercepta aquí una sola vez.
const conectarOriginal = net.Socket.prototype.connect;

net.Socket.prototype.connect = function conectarSoloLocal(...args) {
    let opciones = args[0];
    if (Array.isArray(opciones)) opciones = opciones[0]; // forma interna [opciones, cb]
    let host;
    let ruta;
    if (opciones && typeof opciones === "object") {
        host = opciones.host;
        ruta = opciones.path;
    } else if (typeof opciones === "string" && Number.isNaN(Number(opciones))) {
        ruta = opciones; // socket local (pipe / unix)
    } else {
        host = args[1]; // connect(puerto, host)
    }
    if (ruta || esLocal(host)) return conectarOriginal.apply(this, args);
    const destino = String(host);
    avisar(destino);
    process.nextTick(() => this.destroy(errorBloqueo(destino)));
    return this;
};

// Resolver un nombre externo ya es salir de la máquina.
const lookupOriginal = dns.lookup;
dns.lookup = function lookupSoloLocal(hostname, opciones, callback) {
    if (esLocal(hostname)) return lookupOriginal.call(dns, hostname, opciones, callback);
    const cb = typeof opciones === "function" ? opciones : callback;
    avisar(String(hostname));
    process.nextTick(() => cb && cb(errorBloqueo(String(hostname))));
    return {};
};
if (dns.promises && dns.promises.lookup) {
    const lookupPromesa = dns.promises.lookup;
    dns.promises.lookup = function lookupPromesaSoloLocal(hostname, opciones) {
        if (esLocal(hostname)) return lookupPromesa.call(dns.promises, hostname, opciones);
        avisar(String(hostname));
        return Promise.reject(errorBloqueo(String(hostname)));
    };
}

module.exports = { MARCA, esLocal };
