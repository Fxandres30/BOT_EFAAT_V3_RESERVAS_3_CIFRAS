// ==========================================================================
// workerExpulsiones.js — procesa las expulsiones pendientes de cada cliente
// y mantiene bajo vigilancia a sus bloqueados.
//
// Mismo patrón que workerInactividad.js: un setInterval por sesión activa
// (bot/index.js lo arranca y lo detiene con el resto de workers) y
// propiedadSesion.puedeActuar() antes de cada tick. Al arrancar:
//   - lo que quedó "sesion_desconectada" se retoma ya (la sesión volvió);
//   - una primera pasada a los pocos segundos recupera lo pendiente y lo que
//     una instancia caída dejó en_curso (lease vencido).
// Cada tick (BLOQUEO_EXPULSION_INTERVALO_MS):
//   1. procesa las tareas cuyo turno llegó (procesarExpulsion.js);
//   2. si toca, la vigilancia (vigilanciaBloqueados.js, cada
//      BLOQUEO_VIGILANCIA_INTERVALO_MS) lee los participantes reales y
//      reabre las tareas de quien haya reaparecido. Si WhatsApp no responde,
//      la próxima revisión se espacia (x2 hasta BLOQUEO_VIGILANCIA_ESPERA_MAX_MS).
// Un tick no empieza mientras el anterior de la misma sesión siga en curso.
// Con BLOQUEO_EXPULSION_MODO sin definir o "desactivado" no arranca.
// ==========================================================================

const propiedadSesion = require("../../../services/baileys/propiedadSesion");
const repo = require("./expulsionesRepo");
const { leerConfigExpulsiones, esperaVigilancia } = require("./configExpulsiones");
const { procesarPendientesDe } = require("./procesarExpulsion");
const { vigilarCliente } = require("./vigilanciaBloqueados");

const PRIMERA_PASADA_MS = 5000;
// La primera revisión espera a que el escáner de identidades termine su
// propio groupFetchAllParticipating al conectar (misma cola de la sesión).
const PRIMERA_VIGILANCIA_MS = 20000;

const workers = new Map(); // sessionId -> { intervalo, inicial, vigilancia, ocupado }

// estadoVigilancia: { proxima: ms epoch, fallos } (lo guarda el worker de la
// sesión). Sin él (llamada suelta), solo procesa las tareas.
async function tick(sock, { config = leerConfigExpulsiones(), deps, depsVigilancia, estadoVigilancia = null, ahoraMs = Date.now() } = {}) {

    const usuarioId = sock?.context?.usuarioId;

    if (!usuarioId) return { ok: false, motivo: "sin_tenant" };
    if (!propiedadSesion.puedeActuar(sock)) return { ok: false, motivo: "socket_no_vigente" };

    const procesadas = await procesarPendientesDe(usuarioId, { sock, config, deps });

    if (!estadoVigilancia || ahoraMs < estadoVigilancia.proxima) return { ...procesadas, vigilancia: null };

    const vigilancia = await vigilarCliente(usuarioId, { sock, config, deps: depsVigilancia });

    // Solo los fallos de WhatsApp espacian la revisión; sin sesión o sin
    // bloqueados se vuelve a mirar al ritmo normal.
    estadoVigilancia.fallos = vigilancia.ok || vigilancia.motivo !== "whatsapp" ? 0 : estadoVigilancia.fallos + 1;
    estadoVigilancia.proxima = ahoraMs + esperaVigilancia(estadoVigilancia.fallos, config);

    if (vigilancia.motivo === "whatsapp") {
        console.warn(`⚠️ [VIGILANCIA] no se pudieron leer los grupos (${vigilancia.error}) — próxima revisión en ${Math.round((estadoVigilancia.proxima - ahoraMs) / 1000)} s`);
    }

    return { ...procesadas, vigilancia };

}

function iniciarWorkerExpulsiones(sock) {

    const sessionId = sock?.context?.sessionId;
    const usuarioId = sock?.context?.usuarioId;

    if (!sessionId || !usuarioId) return false;

    const config = leerConfigExpulsiones();

    if (config.modo === "desactivado") {
        console.log("⏸️ [EXPULSIÓN] BLOQUEO_EXPULSION_MODO sin definir o desactivado — worker no iniciado (los bloqueos se registran; las expulsiones quedan pendientes).");
        return false;
    }

    if (config.avisoModo) console.warn(`⚠️ [EXPULSIÓN] ${config.avisoModo}`);

    detenerWorkerExpulsiones(sessionId);

    console.log(`🚫 [EXPULSIÓN] worker iniciado para ${sessionId} (modo ${config.modo}, cada ${config.intervaloMs}ms, vigilancia cada ${config.vigilanciaMs}ms)`);

    const w = { intervalo: null, inicial: null, ocupado: false, vigilancia: { proxima: Date.now() + PRIMERA_VIGILANCIA_MS, fallos: 0 } };

    const ejecutar = async () => {
        if (w.ocupado) return;
        w.ocupado = true;
        try {
            await tick(sock, { estadoVigilancia: w.vigilancia });
        } catch (err) {
            console.error(`❌ [EXPULSIÓN] error en tick (${sessionId}):`, err?.message);
        } finally {
            w.ocupado = false;
        }
    };

    repo.reactivarSinSesion(usuarioId).catch(() => {});

    w.inicial = setTimeout(ejecutar, PRIMERA_PASADA_MS);
    w.intervalo = setInterval(ejecutar, config.intervaloMs);

    w.inicial.unref?.();
    w.intervalo.unref?.();

    workers.set(sessionId, w);

    return true;

}

function detenerWorkerExpulsiones(sessionId) {

    const w = workers.get(sessionId);

    if (!w) return false;

    clearTimeout(w.inicial);
    clearInterval(w.intervalo);
    workers.delete(sessionId);

    return true;

}

module.exports = {
    iniciarWorkerExpulsiones,
    detenerWorkerExpulsiones,
    tick
};
