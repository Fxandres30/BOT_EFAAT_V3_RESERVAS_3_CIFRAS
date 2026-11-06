// ==========================================================================
// C2 (F4-F, 06/11/2026): una sola CREACIÓN de la fila de un sorteo en un
// grupo, aunque lleguen a la vez el anuncio de WhatsApp, el panel u otro
// proceso.
//
// Clave: ACTIVAR_EVENTO:<usuario>:<grupo>:<identidad del sorteo>
//   - sorteo distinto (otra identidad), otro grupo u otro cliente = otra
//     clave: nunca se bloquean entre sí;
//   - la clave es PERMANENTE: un sorteo terminado en un grupo nunca se
//     recrea (detector y publicador paran ante un evento terminado), y una
//     reapertura (F3) reutiliza su fila.
//
// Quien gana el reclamo relee la fila (por si la creó un intento anterior
// que se cortó) y, si no existe, la crea (sustituciones + guardar). Quien
// pierde ADOPTA la fila del ganador; si el ganador sigue trabajando, espera a
// que termine. Un intento fallido (nada guardado o deshecho) o abandonado
// (más de EN_PROGRESO_VENCIDO_MS) se retoma de forma segura.
// Si el registro no está disponible se crea como antes de F4-F.
// ==========================================================================

"use strict";

const reclamos = require("../../../../../automation/reclamos");
const { UMBRALES, retomarAbandonado, RETOMAR_PROPIO } = require("../../../../../automation/recuperacion");
const { eliminado } = require("../../../../../shared/eventos/estadosGestion");

const TIPO = "ACTIVAR_EVENTO";
const EN_PROGRESO_VENCIDO_MS = UMBRALES.RECLAMO_ACTIVACION_MS;
const RONDAS = 3;

const claveActivacion = ({ usuarioId, grupoId, identidad }) => `${TIPO}:${usuarioId}:${grupoId}:${identidad}`;

// La fila de ESTE sorteo en el grupo, sin las eliminadas (como la detección
// de siempre: un sorteo eliminado del panel no impide anunciarlo de nuevo).
// Un error de lectura LANZA: nunca se crea a ciegas.
async function filaDelSorteo(consultarEventoDelSorteo, { grupoId, usuarioId, identidad }) {
    const r = await consultarEventoDelSorteo(grupoId, usuarioId, identidad);
    if (!r?.ok) throw new Error("no se pudo leer la fila del sorteo en el grupo");
    return r.data && !eliminado(r.data) ? r.data : null;
}

// crear() -> { evento, … } | { fallo }   (sustituciones + guardar)
// -> { creado } | { adoptado: fila } | { fallo: { resultado } }
// propietario (solo el panel): { sorteo_id } del destino que activa. Ese
// destino solo lo trabaja un proceso a la vez (reclamarGrupo), así que si
// encuentra SU reclamo «en curso», el intento anterior murió (F4-G): se
// retoma sin esperar (RETOMAR_PROPIO), igual que el reclamo K3.
async function crearOAdoptar({ db, usuarioId, grupoId, identidad, entrada, crear, consultarEventoDelSorteo, propietario = null }) {

    const buscarFila = () => filaDelSorteo(consultarEventoDelSorteo, { grupoId, usuarioId, identidad });

    if (!usuarioId || !grupoId || !identidad) return { creado: await crear() };

    const clave = claveActivacion({ usuarioId, grupoId, identidad });

    for (let ronda = 0; ronda < RONDAS; ronda++) {

        let propio = null;
        const previo = propietario?.sorteo_id ? await reclamos.leer(db, clave).catch(() => null) : null;
        const esSuyo = Boolean(previo) && previo.detalle?.sorteo_id === propietario.sorteo_id;
        const r = await reclamos.reclamar({
            db, clave, tipo: TIPO, usuarioId, grupoId,
            detalle: { entrada, ...(propietario?.sorteo_id ? { sorteo_id: propietario.sorteo_id } : {}) },
            retomar: esSuyo ? RETOMAR_PROPIO : retomarAbandonado(EN_PROGRESO_VENCIDO_MS),
            ejecutar: async () => {
                const existente = await buscarFila();
                if (existente) {
                    propio = { adoptado: existente };
                    return { evento_id: existente.id, adoptada: true };
                }
                const c = await crear();
                if (c.fallo) {
                    propio = { fallo: c.fallo };
                    throw new Error(`activación sin completar (${c.fallo.resultado})`);
                }
                propio = { creado: c };
                return { evento_id: c.evento.id };
            }
        });

        if (r.estado === "ejecutado") return propio;
        if (r.estado === "fallo") {
            if (propio) return propio;
            throw r.error;
        }
        if (r.estado === "sin_registro") {
            console.warn(`⚠️ [ACTIVACIÓN] registro de reclamos no disponible: se crea sin protección (${r.error?.message || r.error?.code || "?"}).`);
            return { creado: await crear() };
        }
        if (r.estado === "completado") {
            const fila = await buscarFila();
            if (fila) return { adoptado: fila };
            // Completado pero su fila ya no está (eliminada desde el panel):
            // se libera la clave (se conserva renombrada) y se vuelve a crear.
            await reclamos.liberar({ db, clave, motivo: "fila_eliminada" });
            continue;
        }
        // en_curso: otro proceso la está creando ahora; fallido_previo: otro
        // la retomó a la vez. Se espera y se vuelve a mirar.
        if (r.estado === "en_curso") await reclamos.esperar({ db, clave });
    }

    return { fallo: { resultado: "activacion_en_curso" } };

}

module.exports = { crearOAdoptar, claveActivacion, TIPO, EN_PROGRESO_VENCIDO_MS };
