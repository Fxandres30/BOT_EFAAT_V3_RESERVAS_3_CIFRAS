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
//
// Opcionales (F3, 06/11/2026; sin ellos el comportamiento es EXACTAMENTE el
// de siempre):
//   db       cliente de Supabase (por defecto lib/supabase). Lo pasan quienes
//            ya reciben su propio cliente (el orquestador de cierre).
//   retomar  { trasError, enProgresoVencidoMs, okVencidoMs }: una acción ya
//            registrada se puede volver a ejecutar si quedó en 'error'
//            (trasError), si lleva más de enProgresoVencidoMs 'en_progreso'
//            (el proceso murió a mitad) o si su 'ok' tiene más de okVencidoMs.
//            La toma es un UPDATE condicionado al estado y a la marca de
//            tiempo leídos (compare-and-swap en Postgres): de dos procesos
//            que intentan retomar la misma clave, solo uno lo consigue; el
//            otro recibe "ya_<estado>" como siempre. La fila sigue siendo
//            una sola por clave; detalle.intentos cuenta las ejecuciones.
//   detalle  (F4-F) detalle INICIAL, guardado ya al adquirir la acción (p. ej.
//            su dueño) y conservado en el resultado final y al retomarla.
//
// Garantías (F4-F):
//   - Adquisición: el INSERT choca con UNIQUE(clave_idempotencia) (006):
//     Postgres serializa los INSERT concurrentes sobre el índice único y solo
//     uno gana; los demás reciben 23505.
//   - Un dueño ANTIGUO nunca pisa a quien retomó su acción: el resultado se
//     escribe condicionado a la marca ejecutado_en de SU toma, y cada toma
//     usa una marca estrictamente posterior a la anterior.
async function ejecutarUnaVez({
    claveIdempotencia,
    eventSessionId = null,
    grupoId,
    usuarioId,
    tipoAccion,
    ejecutar,
    db = supabase,
    retomar = null,
    detalle = null
}) {

    if (!claveIdempotencia) {
        throw new Error("ejecutarUnaVez: claveIdempotencia es obligatoria");
    }

    if (typeof ejecutar !== "function") {
        throw new Error("ejecutarUnaVez: ejecutar debe ser una función");
    }

    const { data: fila, error: errorInsert } = await db
        .from("automation_actions")
        .insert({

            event_session_id: eventSessionId,
            grupo_id: grupoId,
            usuario_id: usuarioId,
            tipo_accion: tipoAccion,
            clave_idempotencia: claveIdempotencia,
            estado: ESTADOS.EN_PROGRESO,
            ...(detalle ? { detalle } : {})

        })
        .select()
        .single();

    if (errorInsert) {

        if (esViolacionUnicidad(errorInsert)) {

            const existente = await obtenerPorClave(claveIdempotencia, db);

            if (existente && retomar && sePuedeRetomar(existente, retomar)) {

                const tomada = await retomarAccion(db, existente, detalle);

                if (tomada) return ejecutarRegistrada(db, tomada, ejecutar, { ...(detalle || {}), intentos: tomada.detalle?.intentos });

                // Otro proceso la retomó primero: se informa su estado actual.
                const actual = await obtenerPorClave(claveIdempotencia, db);

                return {
                    ejecutada: false,
                    motivo: actual ? `ya_${actual.estado}` : "conflicto_desconocido",
                    accion: actual || null
                };

            }

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

    const extra = { ...(detalle || {}), ...(retomar ? { intentos: 1 } : {}) };
    return ejecutarRegistrada(db, fila, ejecutar, Object.keys(extra).length ? extra : null);

}

// La fila 'en_progreso' ya está persistida ANTES de ejecutar el callback
// real — es lo que garantiza que un crash a mitad de camino deje evidencia
// (ver cabecera del archivo). `extra` se conserva en el detalle final.
async function ejecutarRegistrada(db, fila, ejecutar, extra) {

    try {

        const resultado = await ejecutar();

        const filaFinal = await marcarResultado(fila.id, ESTADOS.OK, { ...(extra || {}), resultado: resultado ?? null }, db, fila.ejecutado_en);

        return { ejecutada: true, resultado, accion: filaFinal };

    } catch (err) {

        const detalleError = { ...(extra || {}), mensaje: err?.message || String(err) };

        const filaFinal = await marcarResultado(fila.id, ESTADOS.ERROR, detalleError, db, fila.ejecutado_en);

        return { ejecutada: false, motivo: "fallo_ejecucion", error: err, accion: filaFinal };

    }

}

function msDesde(instante) {
    const t = instante ? new Date(instante).getTime() : NaN;
    return Number.isFinite(t) ? Date.now() - t : Infinity;
}

function sePuedeRetomar(accion, { trasError = false, enProgresoVencidoMs = null, okVencidoMs = null }) {
    if (accion.estado === ESTADOS.ERROR) return Boolean(trasError);
    if (accion.estado === ESTADOS.EN_PROGRESO) return enProgresoVencidoMs != null && msDesde(accion.ejecutado_en) > enProgresoVencidoMs;
    if (accion.estado === ESTADOS.OK) return okVencidoMs != null && msDesde(accion.finalizado_en || accion.actualizado_en) > okVencidoMs;
    return false;
}

// Compare-and-swap: solo si la fila sigue en el estado y con la marca de
// tiempo leídos. -> la fila tomada (ya 'en_progreso') o null.
async function retomarAccion(db, existente, detalleBase = null) {

    // Marca estrictamente posterior a la de la toma anterior (aunque el reloj
    // no haya avanzado): así el dueño antiguo ya no coincide al terminar.
    const previa = Date.parse(existente.ejecutado_en || "") || 0;
    const ahora = new Date(Math.max(Date.now(), previa + 1)).toISOString();
    const intentos = (Number(existente.detalle?.intentos) || 1) + 1;

    let q = db.from("automation_actions")
        .update({
            estado: ESTADOS.EN_PROGRESO,
            ejecutado_en: ahora,
            finalizado_en: null,
            actualizado_en: ahora,
            detalle: { ...(detalleBase || {}), intentos, retomada_desde: existente.estado, ultimo_error: existente.detalle?.mensaje || null }
        })
        .eq("id", existente.id)
        .eq("estado", existente.estado);

    if (existente.actualizado_en) q = q.eq("actualizado_en", existente.actualizado_en);

    const { data, error } = await q.select();

    if (error || !Array.isArray(data) || data.length !== 1) return null;

    return data[0];

}

// ejecutadoEn: la marca de la toma que termina. Si otro proceso retomó la
// acción entretanto (marca distinta), no se escribe nada: el resultado
// vigente es el del dueño actual.
async function marcarResultado(id, estado, detalle, db = supabase, ejecutadoEn = null) {

    const ahora = new Date().toISOString();

    let q = db
        .from("automation_actions")
        .update({

            estado,
            finalizado_en: ahora,
            actualizado_en: ahora,
            detalle: detalle || {}

        })
        .eq("id", id);

    if (ejecutadoEn) q = q.eq("ejecutado_en", ejecutadoEn);

    const { data: filas, error } = await q.select();
    const data = Array.isArray(filas) ? filas[0] || null : filas;

    if (!error && !data) {
        console.warn(`⚠️ [AUTOMATION] la acción ${id} la retomó otro proceso: no se escribe el resultado (${estado}) de este intento.`);
        return null;
    }

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

async function obtenerPorClave(claveIdempotencia, db = supabase) {

    const { data, error } = await db
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

// Libera una clave para que la misma acción se pueda volver a ejecutar más
// adelante (p. ej. cerrar otra vez un grupo tras reabrir el sorteo). No borra
// nada: la fila conserva su historia con la clave renombrada
// (<clave>:retirada:<instante>). Solo se retira una acción terminada (ok o
// error): una en curso pertenece a otro proceso. -> true si la retiró o no
// existía; false si no se pudo.
async function retirarClave(claveIdempotencia, { db = supabase, motivo = null } = {}) {

    const existente = await obtenerPorClave(claveIdempotencia, db).catch(() => undefined);
    if (existente === undefined) return false;
    if (!existente) return true;
    if (existente.estado === ESTADOS.EN_PROGRESO) return false;

    const ahora = new Date().toISOString();
    const { data, error } = await db.from("automation_actions")
        .update({
            clave_idempotencia: `${claveIdempotencia}:retirada:${ahora}`,
            actualizado_en: ahora,
            detalle: { ...(existente.detalle || {}), retirada_en: ahora, motivo_retirada: motivo }
        })
        .eq("id", existente.id)
        .eq("clave_idempotencia", claveIdempotencia)
        .eq("estado", existente.estado)
        .select();

    return !error && Array.isArray(data) && data.length === 1;

}

module.exports = {
    ESTADOS,
    ejecutarUnaVez,
    retirarClave,
    obtenerPorClave,
    obtenerAccionesEstancadas,
    esViolacionUnicidad
};
