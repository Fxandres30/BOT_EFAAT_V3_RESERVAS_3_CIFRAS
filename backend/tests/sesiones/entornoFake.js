// ==========================================================================
// Entorno fake para las pruebas del bucle de reconexión de sockets.
//
// Inyecta, vía require.cache, sustitutos de:
//   - ../../lib/supabase              (fakeSupabaseSesiones)
//   - @whiskeysockets/baileys         (makeWASocket / useMultiFileAuthState
//                                       controlables; DisconnectReason real)
//   - ../../bot/events/groups         (registerGroups no-op)
//
// y luego recarga limpios (delete + require) los módulos REALES bajo
// prueba: socket.js, manager.js, estados.js, desconectado.js, conectado.js.
//
// A propósito NO toca ni carga bot/index.js, ni nada de eventos/mensajes/
// escáner de identidades — esas piezas están fuera del alcance de esta
// corrección y no deben verse afectadas ni son necesarias para probar el
// lock de creación / el guard de identidad / la rama 440.
// ==========================================================================

const path = require("path");
const { EventEmitter } = require("events");

const { crearFakeSupabaseSesiones } = require("./fakeSupabaseSesiones");

const RAIZ = path.resolve(__dirname, "../..");

const RUTAS = {
    supabase: path.join(RAIZ, "lib/supabase.js"),
    groups: path.join(RAIZ, "bot/events/groups.js"),
    socket: path.join(RAIZ, "services/baileys/socket.js"),
    manager: path.join(RAIZ, "services/baileys/manager.js"),
    lease: path.join(RAIZ, "services/baileys/lease.js"),
    estados: path.join(RAIZ, "services/baileys/estados.js"),
    desconectado: path.join(RAIZ, "services/baileys/desconectado.js"),
    conectado: path.join(RAIZ, "services/baileys/conectado.js"),
    qr: path.join(RAIZ, "services/baileys/qr.js"),
    timeout: path.join(RAIZ, "services/baileys/timeout.js"),
    identidadSesion: path.join(RAIZ, "services/baileys/identidadSesion.js")
};

const RUTA_BAILEYS = require.resolve("@whiskeysockets/baileys");

function inyectar(rutaAbs, exportsObj) {
    require.cache[rutaAbs] = {
        id: rutaAbs,
        filename: rutaAbs,
        loaded: true,
        exports: exportsObj
    };
}

function limpiarCache() {
    for (const ruta of Object.values(RUTAS)) {
        delete require.cache[ruta];
    }
    delete require.cache[RUTA_BAILEYS];
}

// Crea un socket falso con la MISMA superficie que usa el código real:
// .ev (EventEmitter real, así varios .on() sobre el mismo evento conviven
// como en Baileys de verdad), .user, .context, .logout().
function crearFakeSocket() {

    const ev = new EventEmitter();
    // Baileys real puede tener muchos listeners legítimos por socket
    // (groups.update, group-participants.update, creds.update,
    // connection.update x2, messages.upsert...) — subir el límite evita
    // warnings ruidosos que no indican ninguna fuga real en estas pruebas.
    ev.setMaxListeners(50);

    return {
        ev,
        user: null,
        context: null,
        logout: async () => {}
    };

}

// Construye el entorno completo. `estadoBaileys.gate` es una promesa que
// useMultiFileAuthState() espera antes de resolver — controlarla desde la
// prueba permite reproducir con precisión la ventana de carrera entre dos
// llamadas a start()/createSocket() para el MISMO sessionId, sin usar
// sleeps de duración fija.
function crearEntorno({ sesionesIniciales = [] } = {}) {

    limpiarCache();

    const fakeSupabase = crearFakeSupabaseSesiones(sesionesIniciales);

    const estadoBaileys = {
        gate: Promise.resolve(),
        llamadasMakeWASocket: 0,
        socketsCreados: []
    };

    const baileysReal = (() => {
        // Cargar el paquete real UNA vez (sin nuestra inyección todavía)
        // solo para tomar prestado el enum DisconnectReason verdadero, así
        // las pruebas usan los mismos códigos numéricos que produce la
        // librería en producción (440, 515, 401, ...).
        delete require.cache[RUTA_BAILEYS];
        return require("@whiskeysockets/baileys");
    })();

    const { DisconnectReason } = baileysReal;

    const mockBaileys = {

        default: function makeWASocket(_opts) {

            estadoBaileys.llamadasMakeWASocket++;

            const sock = crearFakeSocket();

            estadoBaileys.socketsCreados.push(sock);

            return sock;

        },

        useMultiFileAuthState: async function (_authFolder) {

            await estadoBaileys.gate;

            return {
                state: { creds: {} },
                saveCreds: () => {}
            };

        },

        DisconnectReason

    };

    inyectar(RUTAS.supabase, fakeSupabase.client);
    inyectar(RUTA_BAILEYS, mockBaileys);
    inyectar(RUTAS.groups, { registerGroups: () => {} });

    // Recargar limpios los módulos reales bajo prueba, en orden de
    // dependencia, para que todos tomen las inyecciones de arriba.
    delete require.cache[RUTAS.identidadSesion];
    delete require.cache[RUTAS.timeout];
    delete require.cache[RUTAS.qr];
    delete require.cache[RUTAS.conectado];
    delete require.cache[RUTAS.lease];
    delete require.cache[RUTAS.desconectado];
    delete require.cache[RUTAS.estados];
    delete require.cache[RUTAS.socket];
    delete require.cache[RUTAS.manager];

    const socketMod = require(RUTAS.socket);
    const lease = require(RUTAS.lease);
    const manager = require(RUTAS.manager);

    return {
        fakeSupabase,
        estadoBaileys,
        socketMod,
        manager,
        lease,
        DisconnectReason,
        limpiar: limpiarCache
    };

}

// Espera N vueltas del event loop (macrotask vía setImmediate). Se usa
// para dejar terminar cadenas async disparadas por sock.ev.emit(...) que
// nadie más awaitea directamente (igual que en producción: Baileys emite
// eventos, no promesas). No es un sleep de duración fija: cada vuelta
// avanza en cuanto el loop está libre.
function flush(vueltas = 8) {

    return new Promise(resolve => {

        let restantes = vueltas;

        function siguiente() {
            if (restantes-- <= 0) return resolve();
            setImmediate(siguiente);
        }

        siguiente();

    });

}

// Diferido controlable, para abrir/cerrar manualmente la puerta que
// useMultiFileAuthState() espera.
function crearDiferido() {

    let resolve;

    const promise = new Promise(res => { resolve = res; });

    return { promise, resolve };

}

// Acelera setTimeout globalmente (delay -> 0) mientras dura la prueba, para
// no depender de sleeps reales de 1s (conectado.js) ni 5s (desconectado.js,
// reintento "temporal"). Mismo enfoque que ya usa
// backend/_test_fase8_sesiones.js para setInterval/clearInterval.
// Referencia nativa capturada ANTES de que cualquier prueba pueda llamar a
// acelerarTimers() — sirve para esperar una cantidad real (pequeña) de
// tiempo cuando hace falta dejar correr un setInterval real de fondo (p.
// ej. el heartbeat automático del lease), sin que la aceleración global de
// setTimeout la reduzca a 0.
const setTimeoutNativo = global.setTimeout;

let _setTimeoutOriginal = null;

function acelerarTimers() {

    if (_setTimeoutOriginal) return;

    _setTimeoutOriginal = global.setTimeout;

    global.setTimeout = (fn, _ms, ...args) => _setTimeoutOriginal(fn, 0, ...args);

}

function restaurarTimers() {

    if (!_setTimeoutOriginal) return;

    global.setTimeout = _setTimeoutOriginal;

    _setTimeoutOriginal = null;

}

// Espera hasta que `condicionFn()` sea verdadera, revisando en cada vuelta
// del event loop (setImmediate), en vez de asumir un número fijo de
// vueltas. Preferible a flush(N) para esperar una transición de estado
// concreta (p. ej. "ya se emitió activeChanged"): un número fijo de
// vueltas es frágil porque la cantidad real de saltos async depende de
// cuántos setTimeout/microtareas de OTRAS pruebas siguen drenándose en el
// mismo proceso. No es un sleep de duración fija — cada vuelta dura lo que
// tarde el event loop en quedar libre, normalmente fracciones de
// milisegundo, y termina en cuanto la condición se cumple.
async function esperarHasta(condicionFn, { maxVueltas = 500, mensaje = "la condición esperada no se cumplió a tiempo" } = {}) {

    for (let i = 0; i < maxVueltas; i++) {

        if (condicionFn()) return;

        await new Promise(resolve => setImmediate(resolve));

    }

    if (!condicionFn()) {
        throw new Error(`esperarHasta: ${mensaje}`);
    }

}

// Como esperarHasta(), pero para condiciones que dependen de un
// setInterval/setTimeout REAL corriendo de fondo (p. ej. el heartbeat
// automático del lease) que acelerarTimers() no toca (solo intercepta
// setTimeout, no setInterval). Un poll basado en setImmediate puro puede
// agotar miles de vueltas en microsegundos, mucho antes de que un timer
// real de pocos milisegundos llegue a dispararse ni una vez — por eso acá
// cada vuelta espera un paso real pequeño (setTimeoutNativo), no un
// setImmediate. Sigue sin ser un sleep de duración fija: termina apenas la
// condición se cumple, el `pasoMs` solo define la resolución del poll.
async function esperarHastaReal(condicionFn, { maxEsperaMs = 2000, pasoMs = 5, mensaje = "la condición esperada no se cumplió a tiempo" } = {}) {

    const limite = Date.now() + maxEsperaMs;

    while (Date.now() < limite) {

        if (condicionFn()) return;

        await new Promise(resolve => setTimeoutNativo(resolve, pasoMs));

    }

    if (!condicionFn()) {
        throw new Error(`esperarHastaReal: ${mensaje}`);
    }

}

module.exports = {
    crearEntorno,
    flush,
    crearDiferido,
    acelerarTimers,
    restaurarTimers,
    esperarHasta,
    esperarHastaReal,
    RUTAS
};
