// ==========================================================================
// workerExpulsiones.js — procesa las expulsiones pendientes de cada cliente.
//
// Mismo patrón que workerInactividad.js: un setInterval por sesión activa
// (bot/index.js lo arranca y lo detiene con el resto de workers) y
// propiedadSesion.puedeActuar() antes de cada tick. Al arrancar:
//   - lo que quedó "sesion_desconectada" se retoma ya (la sesión volvió);
//   - una primera pasada a los pocos segundos recupera lo pendiente y lo que
//     una instancia caída dejó en_curso (lease vencido).
// Con BLOQUEO_EXPULSION_MODO sin definir o "desactivado" no arranca.
// ==========================================================================

const propiedadSesion = require("../../../services/baileys/propiedadSesion");
const repo = require("./expulsionesRepo");
const { leerConfigExpulsiones } = require("./configExpulsiones");
const { procesarPendientesDe } = require("./procesarExpulsion");

const PRIMERA_PASADA_MS = 5000;

const workers = new Map(); // sessionId -> { intervalo, inicial }

async function tick(sock, { config = leerConfigExpulsiones(), deps } = {}) {

    const usuarioId = sock?.context?.usuarioId;

    if (!usuarioId) return { ok: false, motivo: "sin_tenant" };
    if (!propiedadSesion.puedeActuar(sock)) return { ok: false, motivo: "socket_no_vigente" };

    return procesarPendientesDe(usuarioId, { sock, config, deps });

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

    console.log(`🚫 [EXPULSIÓN] worker iniciado para ${sessionId} (modo ${config.modo}, cada ${config.intervaloMs}ms)`);

    const ejecutar = () => tick(sock).catch(err => console.error(`❌ [EXPULSIÓN] error en tick (${sessionId}):`, err?.message));

    repo.reactivarSinSesion(usuarioId).catch(() => {});

    const inicial = setTimeout(ejecutar, PRIMERA_PASADA_MS);
    const intervalo = setInterval(ejecutar, config.intervaloMs);

    inicial.unref?.();
    intervalo.unref?.();

    workers.set(sessionId, { intervalo, inicial });

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
