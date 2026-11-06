// ==========================================================================
// K3 (F4-F, 06/11/2026): UNA sola publicación de un sorteo en un grupo,
// aunque dos programaciones del MISMO sorteo (misma identidad) apunten al
// mismo grupo y se confirmen a la vez.
//
// Clave: PUBLICAR_SORTEO:<usuario>:<grupo>:<identidad del sorteo>
// Dueño: la programación que adquiere el reclamo (detalle.sorteo_id, guardado
// ya al adquirirlo). La identidad es estable: no depende de la memoria ni de
// la programación, solo del sorteo real y del grupo.
//
//   la misma programación (dueña)  publica como siempre: sus reintentos
//                                  automáticos y manuales no cambian (el
//                                  anuncio sigue protegido por su propia clave)
//   otra programación:
//     el dueño ya publicó          ADOPTA (F4-F.1): su destino queda
//                                  «publicado» con la MISMA fila del evento
//                                  (publicación compartida); no se envía
//                                  imagen, anuncio, apertura ni ciclo, y sus
//                                  comunicaciones las gobierna la propietaria
//                                  (sorteos/publicacionCompartida.js). Nunca
//                                  se cancela la programación del administrador
//     el dueño está publicando,    ESPERA (pendiente): un anuncio incierto
//     o su intento falló y sigue   nunca se repite desde otra programación
//     activo
//     el dueño lo abandonó (su     lo RETOMA y pasa a ser la dueña
//     destino o su programación
//     cancelados/archivados, o
//     en curso más de 10 min)
// Programaciones de OTRO sorteo (otra identidad) u otro grupo: clave
// distinta, nunca se bloquean. Sin registro disponible: como antes de F4-F.
// ==========================================================================

"use strict";

const reclamos = require("../automation/reclamos");
const { UMBRALES, retomarAbandonado, RETOMAR_PROPIO, edadMs } = require("../automation/recuperacion");
const repo = require("./repo");

const TIPO = "PUBLICAR_SORTEO";
// Umbrales y reglas de retomar: comunes (automation/recuperacion.js, F4-G).
const EN_PROGRESO_VENCIDO_MS = UMBRALES.RECLAMO_PUBLICACION_MS;
const RETOMAR = retomarAbandonado(EN_PROGRESO_VENCIDO_MS);
const RETOMAR_PROPIO_DESTINO = RETOMAR_PROPIO;
// La DUEÑA retoma su propio reclamo «en curso» sin esperar (RETOMAR_PROPIO,
// automation/recuperacion.js): un destino solo lo toma un proceso a la vez.


const clavePublicacion = ({ usuarioId, grupoId, identidad }) => `${TIPO}:${usuarioId}:${grupoId}:${identidad}`;

const ADOPTADA = "Publicación compartida: este mismo sorteo (misma lotería, fecha, hora y valor) ya lo publicó en este grupo otra programación. No se envió otro anuncio; recordatorios y aviso de cierre los envía la propietaria.";

// El destino adopta la publicación de la propietaria y queda en el historial
// de la programación con la relación (trazabilidad).
async function adoptar(accion, { usuarioId, sorteoId, grupoId, version }) {
    const eventoId = accion?.detalle?.resultado?.evento_bot_id || null;
    const propietaria = accion?.detalle?.sorteo_id || null;
    await repo.registrarHistorial(usuarioId, sorteoId, "publicacion_compartida", "adoptada", {
        grupo_id: grupoId, programacion_propietaria: propietaria, evento_bot_id: eventoId, motivo: ADOPTADA
    }).catch(() => null);
    return {
        estado: "publicado",
        evento_bot_id: eventoId,
        version_publicada: version ?? null,
        publicado_en: accion?.finalizado_en || accion?.actualizado_en || new Date().toISOString(),
        ultimo_error: null
    };
}


// ¿La programación dueña sigue intentando publicar en este grupo?
async function duenoSigueActivo(usuarioId, duenoId, grupoId) {
    const r = await repo.obtenerSorteo(usuarioId, duenoId);
    if (!r.ok) return r.motivo !== "no_encontrado"; // sin poder leerlo, se espera
    if (r.data.estado === "cancelado" || r.data.archivado_en) return false;
    const destino = (r.data.grupos || []).find(g => g.grupo_id === grupoId);
    return Boolean(destino) && destino.estado !== "cancelado";
}

// publicar() -> los cambios del destino de siempre.
// esperar(motivo, { dueno }) -> los cambios de un destino «en espera». dueno =
// la programación que tiene ahora el reclamo (F4-G: la recuperación no toca un
// destino cuyo reclamo está cerrando OTRO proceso de su misma programación).
async function publicarUnaVez({ db, usuarioId, grupoId, identidad, sorteoId, version = null, publicar, esperar }) {

    if (!usuarioId || !grupoId || !identidad) return publicar();

    const clave = clavePublicacion({ usuarioId, grupoId, identidad });
    const contexto = { usuarioId, sorteoId, grupoId, version };
    const enEspera = (dueno) => esperar("Otra programación de este mismo sorteo se está publicando en este grupo; se publicará o se adoptará cuando termine.", { dueno: dueno || null });

    let actual;
    try { actual = await reclamos.leer(db, clave); } catch { return publicar(); }

    const dueno = actual?.detalle?.sorteo_id || null;
    const ajeno = Boolean(actual) && dueno !== sorteoId;
    let retomar = actual ? RETOMAR_PROPIO_DESTINO : null; // la dueña retoma lo suyo

    if (ajeno) {
        if (actual.estado === "ok") return adoptar(actual, contexto);
        const abandonado = actual.estado === "en_progreso"
            ? edadMs(actual?.ejecutado_en) > EN_PROGRESO_VENCIDO_MS
            : !(await duenoSigueActivo(usuarioId, dueno, grupoId));
        if (!abandonado) return enEspera(dueno);
        retomar = RETOMAR; // abandonado por su dueña: se retoma con la regla general
    } else if (!actual) {
        retomar = null; // nadie la tiene: adquirirla, sin retomar la de otro
    }

    let cambios = null;
    const r = await reclamos.reclamar({
        db, clave, tipo: TIPO, usuarioId, grupoId, detalle: { sorteo_id: sorteoId }, retomar,
        ejecutar: async () => {
            cambios = await publicar();
            if (cambios?.estado !== "publicado") throw new Error(`publicación sin completar (${cambios?.estado})`);
            return { sorteo_id: sorteoId, evento_bot_id: cambios.evento_bot_id || null };
        }
    });

    if (r.estado === "ejecutado") return cambios;
    if (r.estado === "fallo") {
        if (cambios) return cambios;
        throw r.error;
    }
    if (r.estado === "sin_registro") return publicar();
    if (r.estado === "completado") {
        // La misma programación ya publicó aquí (reintento manual, recuperación):
        // publica como siempre; su anuncio tiene su propia clave.
        if (r.accion?.detalle?.sorteo_id === sorteoId) return publicar();
        return adoptar(r.accion, contexto);
    }
    // en_curso / fallido_previo: otro la tomó a la vez.
    return enEspera(r.accion?.detalle?.sorteo_id);

}

module.exports = { publicarUnaVez, clavePublicacion, TIPO, ADOPTADA, EN_PROGRESO_VENCIDO_MS };
