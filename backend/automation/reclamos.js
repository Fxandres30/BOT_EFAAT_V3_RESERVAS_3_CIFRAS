// ==========================================================================
// RECLAMOS PERSISTENTES (F4-F, 06/11/2026): «solo una operación a la vez
// para esta clave, y las demás reconocen su resultado».
//
// Se apoya en executionGuard (automation_actions, UNIQUE(clave_idempotencia)
// de la 006): la ADQUISICIÓN es un INSERT que Postgres resuelve con un solo
// ganador aunque lleguen varios procesos a la vez; la RECUPERACIÓN de un
// reclamo abandonado o fallido es un UPDATE condicionado (compare-and-swap);
// y un dueño antiguo nunca pisa el resultado de quien lo retomó.
//
// Este módulo solo adquiere, informa y espera. Qué hace quien NO gana
// (adoptar, esperar, retomar) lo decide cada uso:
//   C2  bot/funciones/eventos/lifecycle/activacion/reclamoActivacion.js
//   K3  sorteos/publicacionPorGrupo.js
//   K4  sorteos/creacionIdempotente.js
// ==========================================================================

"use strict";

const executionGuard = require("./executionGuard");

// Reclamos que ESTE proceso tiene en curso: quien espera en el mismo
// proceso no necesita sondear la base. La verdad sigue estando en la base.
const enCursoAqui = new Map();

const esperarMs = (ms) => new Promise(r => setTimeout(r, ms));

// -> { estado, resultado?, error?, accion? } con estado ∈
//   ejecutado      este proceso adquirió el reclamo y ejecutó (resultado)
//   fallo          lo adquirió y la ejecución falló (error); queda «error»
//   completado     otro ya lo completó (accion: detalle.resultado)
//   en_curso       otro lo tiene en este momento
//   fallido_previo el último intento falló y no se pudo retomar
//   sin_registro   el registro no está disponible (error al insertar)
async function reclamar({ db, clave, tipo, usuarioId, grupoId, detalle = null, retomar = null, ejecutar }) {

    let avisar;
    const fin = new Promise(r => { avisar = r; });

    let g;
    try {
        g = await executionGuard.ejecutarUnaVez({
            db, claveIdempotencia: clave, tipoAccion: tipo, usuarioId, grupoId, detalle, retomar,
            ejecutar: async () => {
                enCursoAqui.set(clave, fin);
                return ejecutar();
            }
        });
    } catch (error) {
        return { estado: "sin_registro", error };
    } finally {
        // Después de escribir el resultado en la base: quien espera ya lo lee.
        if (enCursoAqui.get(clave) === fin) enCursoAqui.delete(clave);
        avisar();
    }

    if (g.ejecutada) return { estado: "ejecutado", resultado: g.resultado, accion: g.accion };
    if (g.motivo === "fallo_ejecucion") return { estado: "fallo", error: g.error, accion: g.accion };
    if (g.motivo === "ya_ok") return { estado: "completado", accion: g.accion };
    if (g.motivo === "ya_en_progreso") return { estado: "en_curso", accion: g.accion };
    if (g.motivo === "ya_error") return { estado: "fallido_previo", accion: g.accion };
    return { estado: "sin_registro", error: g.error || null };

}

// Espera a que el reclamo deje de estar «en_progreso». En este proceso, a su
// promesa; si lo tiene otro proceso, sondea la base con espera creciente
// (hasta ~intentos segundos). -> la acción final, o la que siga en curso.
async function esperar({ db, clave, intentos = 30, baseMs = 50 }) {
    const aqui = enCursoAqui.get(clave);
    if (aqui) await aqui;
    let accion = null;
    for (let i = 0; i <= intentos; i++) {
        accion = await executionGuard.obtenerPorClave(clave, db).catch(() => null);
        if (!accion || accion.estado !== executionGuard.ESTADOS.EN_PROGRESO) return accion;
        const otra = enCursoAqui.get(clave);
        if (otra) { await otra; continue; }
        if (i < intentos) await esperarMs(Math.min(baseMs * 2 ** i, 1000));
    }
    return accion;
}

const leer = (db, clave) => executionGuard.obtenerPorClave(clave, db);

// Libera una clave terminada (se conserva renombrada; ver retirarClave).
const liberar = ({ db, clave, motivo }) => executionGuard.retirarClave(clave, { db, motivo });

module.exports = { reclamar, esperar, leer, liberar };
