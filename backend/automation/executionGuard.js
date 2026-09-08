// ==========================================================================
// executionGuard.js — idempotencia real de acciones automáticas.
//
// La protección PRIMARIA es el constraint UNIQUE(clave_idempotencia) de
// Postgres (migración 006), resuelto bajo el lock de fila que Postgres ya
// toma para la unique key — nunca un "select -> comprobar -> insert" desde
// Node (eso permite carreras; ver docs/EFAAT_AUTOMATION_MASTER_SPEC.md §8 y
// PHASE_2A_FINDINGS §10). Mismo principio que ya usa el proyecto en
// lease_sesiones_acquire (004) y pagos_movimientos_unico_no_duplicado (005).
//
// Diseño de DOS FASES (PHASE_2A_FINDINGS §10 — "crash entre INSERT y
// acción real"):
//   1. INSERT con estado='en_progreso'  -> si choca con la UNIQUE, la
//      acción ya existe (en cualquier estado) y NO se ejecuta de nuevo.
//   2. Se ejecuta el callback real.
//   3. UPDATE a 'ok' (éxito) o 'error' (excepción capturada).
//
// Si el proceso muere entre 1 y 3, la fila queda 'en_progreso' para
// siempre hasta que algo la revise — obtenerAccionesEstancadas() SOLO
// LISTA esas filas. Esta fase NO reintenta nada automáticamente (política
// segura por defecto, deliberada).
// ==========================================================================

const supabase = require("../lib/supabase");

const CODIGO_VIOLACION_UNICA_POSTGRES = "23505";

const ESTADOS = Object.freeze({
    EN_PROGRESO: "en_progreso",
    OK: "ok",
    ERROR: "error"
});

function esViolacionUnicidad(error) {

    return !!error && error.code === CODIGO_VIOLACION_UNICA_POSTGRES;

}

// ejecutarUnaVez({ claveIdempotencia, eventSessionId, grupoId, usuarioId,
//                   tipoAccion, ejecutar })
//
// `ejecutar` es una función (puede ser async) SIN argumentos, provista por
// el llamador — este módulo nunca decide QUÉ se ejecuta, solo GARANTIZA que
// se ejecute como máximo una vez por clave.
//
// Devuelve siempre un objeto:
//   { ejecutada: boolean, motivo?: string, resultado?, error?, accion? }
//
// `ejecutada: true`  -> el callback corrió AHORA MISMO (éxito o falla real
//                        de negocio, ver `error`/`resultado`).
// `ejecutada: false` -> no corrió: ya existía (`motivo` empieza con "ya_"),
//                        o falló el propio INSERT por otra razón
//                        (`motivo: "error_insert"`).
async function ejecutarUnaVez({
    claveIdempotencia,
    eventSessionId = null,
    grupoId,
    usuarioId,
    tipoAccion,
    ejecutar
}) {

    if (!claveIdempotencia) {
        throw new Error("ejecutarUnaVez: claveIdempotencia es obligatoria");
    }

    if (typeof ejecutar !== "function") {
        throw new Error("ejecutarUnaVez: ejecutar debe ser una función");
    }

    const { data: fila, error: errorInsert } = await supabase
        .from("automation_actions")
        .insert({

            event_session_id: eventSessionId,
            grupo_id: grupoId,
            usuario_id: usuarioId,
            tipo_accion: tipoAccion,
            clave_idempotencia: claveIdempotencia,
            estado: ESTADOS.EN_PROGRESO

        })
        .select()
        .single();

    if (errorInsert) {

        if (esViolacionUnicidad(errorInsert)) {

            const existente = await obtenerPorClave(claveIdempotencia);

            return {
                ejecutada: false,
                motivo: existente ? `ya_${existente.estado}` : "conflicto_desconocido",
                accion: existente || null
            };

        }

        return {
            ejecutada: false,
            motivo: "error_insert",
            error: errorInsert
        };

    }

    // La fila 'en_progreso' ya está persistida ANTES de ejecutar el
    // callback real — es lo que garantiza que un crash a mitad de camino
    // deje evidencia (ver cabecera del archivo).
    try {

        const resultado = await ejecutar();

        const filaFinal = await marcarResultado(fila.id, ESTADOS.OK, { resultado: resultado ?? null });

        return { ejecutada: true, resultado, accion: filaFinal };

    } catch (err) {

        const detalleError = { mensaje: err?.message || String(err) };

        const filaFinal = await marcarResultado(fila.id, ESTADOS.ERROR, detalleError);

        return { ejecutada: false, motivo: "fallo_ejecucion", error: err, accion: filaFinal };

    }

}

async function marcarResultado(id, estado, detalle) {

    const ahora = new Date().toISOString();

    const { data, error } = await supabase
        .from("automation_actions")
        .update({

            estado,
            finalizado_en: ahora,
            actualizado_en: ahora,
            detalle: detalle || {}

        })
        .eq("id", id)
        .select()
        .single();

    if (error) {

        // No hay forma segura de "deshacer" el intento ya ejecutado — se
        // deja constancia en el log. La fila queda tal como estaba
        // (en_progreso), lo que obtenerAccionesEstancadas() detectará más
        // adelante. No se reintenta el UPDATE en esta fase.
        console.error(`❌ [AUTOMATION] no se pudo registrar el resultado (${estado}) de la acción ${id}:`, error.message);

        return null;

    }

    return data;

}

async function obtenerPorClave(claveIdempotencia) {

    const { data, error } = await supabase
        .from("automation_actions")
        .select("*")
        .eq("clave_idempotencia", claveIdempotencia)
        .maybeSingle();

    if (error) {
        throw error;
    }

    return data;

}

// Lista (no actúa sobre) acciones en_progreso más antiguas que
// `minutosAntiguedad`. Es la única pieza de "recuperación" que existe en
// esta fase — deliberadamente sin ningún reintento automático (política
// segura por defecto, ver cabecera y Master Spec §8 corregido en
// PHASE_2A_FINDINGS §10).
async function obtenerAccionesEstancadas({ minutosAntiguedad = 5 } = {}) {

    const umbral = new Date(Date.now() - minutosAntiguedad * 60 * 1000).toISOString();

    const { data, error } = await supabase
        .from("automation_actions")
        .select("*")
        .eq("estado", ESTADOS.EN_PROGRESO)
        .lt("ejecutado_en", umbral)
        .order("ejecutado_en", { ascending: true });

    if (error) {
        throw error;
    }

    return data || [];

}

module.exports = {
    ESTADOS,
    ejecutarUnaVez,
    obtenerAccionesEstancadas,
    esViolacionUnicidad
};
