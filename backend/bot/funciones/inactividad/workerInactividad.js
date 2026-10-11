// ==========================================================================
// workerInactividad.js — proceso programado del control de inactividad.
//
// Mismo patrón que automation/scheduler.js e iniciarWorkerEventos.js: un
// setInterval por sesión activa (bot/index.js lo arranca y lo detiene con
// el resto de workers), guarda anti-solapamiento en memoria y
// propiedadSesion.puedeActuar() antes de cada tick. Vive dentro del mismo
// proceso Node que PM2 ya administra: no requiere cron externo.
//
// Cada tick (por defecto cada hora) decide si toca evaluar:
//   - el modo no es "desactivado";
//   - la hora de Bogotá es >= INACTIVIDAD_HORA_BOGOTA;
//   - la última ejecución COMPLETADA del tenant (en Supabase, sobrevive a
//     reinicios) empezó hace más de INACTIVIDAD_HORAS_ENTRE_EJECUCIONES.
// La exclusión mutua real entre procesos la da el candado de
// inactividad_ejecuciones (ver inactividadRepo.tomarEjecucion).
// ==========================================================================

const propiedadSesion = require("../../../services/baileys/propiedadSesion");
const repo = require("./inactividadRepo");
const { leerConfigInactividad } = require("./configInactividad");
const { ejecutarControlInactividad } = require("./ejecutarControlInactividad");

const intervalos = new Map(); // sessionId -> intervalId
const ejecutando = new Set(); // sessionId

function horaBogota(ahora) {
    return Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: "America/Bogota" }).format(ahora));
}

// ¿Toca evaluar ahora? Expuesto para pruebas.
async function correspondeEjecutar({ usuarioId, config, ahora = new Date() }) {

    if (config.modo === "desactivado") return { ejecutar: false, motivo: "desactivado" };

    if (horaBogota(ahora) < config.horaBogota) return { ejecutar: false, motivo: "antes_de_la_hora" };

    const ultima = await repo.ultimaEjecucionCompletada(usuarioId);

    if (!ultima.ok) return { ejecutar: false, motivo: ultima.motivo };

    if (ultima.iniciadoEn && ahora.getTime() - ultima.iniciadoEn.getTime() < config.horasEntreEjecuciones * 3600 * 1000) {
        return { ejecutar: false, motivo: "ya_ejecutado_recientemente" };
    }

    return { ejecutar: true };

}

async function tick(sock, { ahora = new Date(), config = leerConfigInactividad(), deps } = {}) {

    const usuarioId = sock?.context?.usuarioId;

    if (!usuarioId) return { ejecutado: false, motivo: "sin_tenant" };

    const decision = await correspondeEjecutar({ usuarioId, config, ahora });

    if (!decision.ejecutar) {
        if (decision.motivo === "migracion_pendiente") {
            console.warn("⚠️ [INACTIVIDAD] falta aplicar supabase_migrations/022_control_inactividad_miembros.sql — control inactivo.");
        }
        return { ejecutado: false, motivo: decision.motivo };
    }

    const informe = await ejecutarControlInactividad({ sock, config, ahora, deps });

    return { ejecutado: !!informe.ok, informe };

}

function iniciarWorkerInactividad(sock) {

    const sessionId = sock?.context?.sessionId;

    if (!sessionId) return false;

    const config = leerConfigInactividad();

    if (config.modo === "desactivado") {
        console.log("⏸️ [INACTIVIDAD] INACTIVIDAD_MODO=desactivado — worker no iniciado.");
        return false;
    }

    detenerWorkerInactividad(sessionId);

    console.log(`🧹 [INACTIVIDAD] worker iniciado para ${sessionId} (modo ${config.modo}, cada ${config.intervaloMs}ms)`);

    const intervalo = setInterval(async () => {

        if (ejecutando.has(sessionId)) return;

        if (!propiedadSesion.puedeActuar(sock)) return;

        ejecutando.add(sessionId);

        try {
            await tick(sock);
        } catch (err) {
            console.error(`❌ [INACTIVIDAD] error en tick (${sessionId}):`, err?.message);
        } finally {
            ejecutando.delete(sessionId);
        }

    }, config.intervaloMs);

    if (typeof intervalo.unref === "function") intervalo.unref();

    intervalos.set(sessionId, intervalo);

    return true;

}

function detenerWorkerInactividad(sessionId) {

    if (!intervalos.has(sessionId)) return false;

    clearInterval(intervalos.get(sessionId));
    intervalos.delete(sessionId);

    return true;

}

module.exports = {
    iniciarWorkerInactividad,
    detenerWorkerInactividad,
    correspondeEjecutar,
    tick
};
