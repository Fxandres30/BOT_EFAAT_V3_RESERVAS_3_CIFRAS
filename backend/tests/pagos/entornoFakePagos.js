// ==========================================================================
// Entorno fake para las pruebas del módulo de pagos P1.
//
// Inyecta, vía require.cache, un sustituto de ../../lib/supabase y
// recarga limpios (delete + require) los módulos reales bajo prueba:
// credenciales.js, hashDuplicado.js, autenticacionDispositivo.js,
// pagosController.js. No toca ni carga nada de sesiones/identidad/bot.
// ==========================================================================

const path = require("path");

const { crearFakeSupabasePagos } = require("./fakeSupabasePagos");

const RAIZ = path.resolve(__dirname, "../..");

const RUTAS = {
    supabase: path.join(RAIZ, "lib/supabase.js"),
    credenciales: path.join(RAIZ, "pagos/credenciales.js"),
    hashDuplicado: path.join(RAIZ, "pagos/hashDuplicado.js"),
    autenticacion: path.join(RAIZ, "pagos/autenticacionDispositivo.js"),
    controller: path.join(RAIZ, "pagos/pagosController.js")
};

function inyectar(rutaAbs, exportsObj) {

    require.cache[rutaAbs] = {
        id: rutaAbs,
        filename: rutaAbs,
        loaded: true,
        exports: exportsObj
    };

}

function crearEntorno() {

    for (const ruta of Object.values(RUTAS)) {
        delete require.cache[ruta];
    }

    const fakeSupabase = crearFakeSupabasePagos();

    inyectar(RUTAS.supabase, fakeSupabase.client);

    const credenciales = require(RUTAS.credenciales);
    const hashDuplicado = require(RUTAS.hashDuplicado);
    const autenticarDispositivo = require(RUTAS.autenticacion);
    const controller = require(RUTAS.controller);

    return {
        fakeSupabase,
        credenciales,
        hashDuplicado,
        autenticarDispositivo,
        controller
    };

}

// --- Helpers de req/res estilo Express, sin levantar un servidor real ---

function crearRes() {

    return {
        statusCode: 200,
        body: null,
        status(codigo) { this.statusCode = codigo; return this; },
        json(payload) { this.body = payload; return this; }
    };

}

function crearReq({ authorization = null, body = {} } = {}) {

    return {
        headers: authorization ? { authorization } : {},
        body
    };

}

// Ejecuta middleware(req,res,next) seguido de handler(req,res) si next() se
// invocó. Devuelve el objeto `res` ya resuelto en ambos casos.
async function ejecutarRuta(middleware, handler, req) {

    const res = crearRes();
    let siguienteLlamado = false;

    await middleware(req, res, () => { siguienteLlamado = true; });

    if (siguienteLlamado) {

        await handler(req, res);

    }

    return res;

}

module.exports = {
    crearEntorno,
    crearReq,
    crearRes,
    ejecutarRuta,
    RUTAS
};
