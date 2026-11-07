// ==========================================================================
// shared/mensajes/etapas/envioUnico.js — envío único (idempotencia).
//
// NO reimplementa la protección: recibe un «guardián» con la MISMA interfaz
// que automation/executionGuard.ejecutarUnaVez (UNIQUE en automation_actions)
// y traduce su resultado. En O2 se le pasará el executionGuard real; las
// pruebas usan crearGuardianMemoria(), con la misma semántica.
//
// Nunca se llama en modo sombra (lo garantiza el orquestador).
// ==========================================================================

"use strict";

// Resultado de ejecutarUnaVez -> estado del orquestador.
function traducir(r) {
    if (r?.ejecutada) return { estado: "enviado", resultado: r.resultado };
    const motivo = r?.motivo || "desconocido";
    if (motivo.startsWith("ya_")) return { estado: "duplicado", motivo };
    if (motivo === "fallo_ejecucion") return { estado: "error", motivo, error: r.error?.message || String(r.error || "") };
    return { estado: "error", motivo, error: r?.error?.message || null };
}

// ejecutar({ guardian, clave, tipoAccion, usuarioId, grupoId, eventSessionId, enviar })
async function ejecutarConClave({ guardian, clave, tipoAccion, usuarioId, grupoId, eventSessionId = null, enviar }) {
    const r = await guardian.ejecutarUnaVez({
        claveIdempotencia: clave,
        ...(eventSessionId ? { eventSessionId } : {}),
        grupoId,
        usuarioId,
        tipoAccion,
        ejecutar: enviar
    });
    return traducir(r);
}

// Guardián en memoria con la semántica de executionGuard: una clave se
// reclama una sola vez (aunque lleguen dos a la vez); éxito -> "ok",
// excepción -> "error"; una clave existente devuelve ya_<estado>.
function crearGuardianMemoria() {
    const acciones = new Map(); // clave -> { estado, tipoAccion, usuarioId, grupoId }
    return {
        acciones,
        async ejecutarUnaVez({ claveIdempotencia, tipoAccion, usuarioId, grupoId, ejecutar }) {
            const existente = acciones.get(claveIdempotencia);
            if (existente) return { ejecutada: false, motivo: `ya_${existente.estado}` };
            const fila = { estado: "en_progreso", tipoAccion, usuarioId, grupoId };
            acciones.set(claveIdempotencia, fila); // reclamo en el mismo turno (sin await antes)
            try {
                const resultado = await ejecutar();
                fila.estado = "ok";
                return { ejecutada: true, resultado };
            } catch (error) {
                fila.estado = "error";
                return { ejecutada: false, motivo: "fallo_ejecucion", error };
            }
        }
    };
}

module.exports = { ejecutarConClave, traducir, crearGuardianMemoria };
