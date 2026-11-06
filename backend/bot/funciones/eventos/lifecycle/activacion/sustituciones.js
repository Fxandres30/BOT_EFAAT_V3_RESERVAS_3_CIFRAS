// ==========================================================================
// Sustituciones al activar un sorteo (F4): qué sorteos anteriores dejan de
// estar vigentes. Reglas de siempre, sin cambios:
//   - UN SORTEO POR PRECIO (01/11): el sorteo activo del MISMO precio se
//     reemplaza en TODOS sus grupos, ANTES de guardar el nuevo (la 043
//     rechaza dos activos del mismo precio). Todo o nada; si el nuevo no se
//     guarda, se deshace (persistencia.js).
//   - Los sorteos propios de OTRO precio abiertos en el grupo (delGrupo, solo
//     el publicador) se reemplazan con él.
//   - La detección cierra además el de otro precio de ESTE grupo, pero
//     DESPUÉS de guardar el nuevo (sustituirEnGrupo).
// Las escrituras las hace el orquestador de cierre (F3) a través de
// shared/eventos/unSorteoPorPrecio y lifecycle/cerrarEvento.
// ==========================================================================

"use strict";

const {
    sorteosActivosDelPrecio,
    filasPorId,
    reemplazarAnteriores
} = require("../../../../../shared/eventos/unSorteoPorPrecio");

// -> { ok: true, reemplazo }
//  | { ok: false, motivo: "lectura" }         no se pudo leer (nada cambió)
//  | { ok: false, motivo: "no_autorizado" }   ocupa otros grupos y quien
//                                              anuncia no puede reemplazarlo
//  | { ok: false, motivo: "error", error }    no se pudo reemplazar (nada cambió)
//
// autorizarOtrosGrupos: solo la detección. Función async que se llama SOLO
// si el precio está ocupado en otros grupos (un cliente que reenvía un
// anuncio viejo nunca se apodera del precio). delGrupo vacío = no se lee
// nada más (filasPorId no consulta con una lista vacía).
async function reemplazarDelPrecio({ db, usuarioId, grupoId = null, valor, identidad, excepto = null, delGrupo = [], motivo, ahora, autorizarOtrosGrupos = null }) {
    const ocupan = await sorteosActivosDelPrecio(db, { usuarioId, valor, identidad, excepto: excepto ? [excepto] : [] });
    // delGrupo se calculó al revisar el grupo y puede haber cambiado: nunca se
    // cierra la fila que se va a reutilizar (excepto) ni una que, entretanto,
    // ya es de ESTE sorteo (p. ej. la corrigió a la vez un anuncio de WhatsApp,
    // F4-F.1). Sin carreras, delGrupo solo tiene filas de otra identidad.
    const delGrupoCompletas = await filasPorId(db, usuarioId, delGrupo.map(f => f.id).filter(id => id !== excepto && !(ocupan.filas || []).some(o => o.id === id)));
    if (!ocupan.ok || !delGrupoCompletas.ok) return { ok: false, motivo: "lectura", error: ocupan.error || delGrupoCompletas.error || null };
    delGrupoCompletas.filas = delGrupoCompletas.filas.filter(f => f.identidad_evento_real !== identidad);
    if (autorizarOtrosGrupos && ocupan.filas.some(f => f.grupo_id !== grupoId) && !(await autorizarOtrosGrupos())) {
        return { ok: false, motivo: "no_autorizado" };
    }
    const reemplazo = await reemplazarAnteriores(db, { usuarioId, filas: [...ocupan.filas, ...delGrupoCompletas.filas], motivo, ahora });
    if (!reemplazo.ok) return { ok: false, motivo: "error", error: reemplazo.error };
    return { ok: true, reemplazo };
}

// El sorteo anterior del grupo deja de estar vigente EN ESTE GRUPO porque se
// anunció otro: se cierra su fila (reservas y pagos intactos, siguen con su
// identidad). Nunca cierra el grupo de WhatsApp (el anuncio nuevo lo abre)
// ni toca las filas de ese sorteo en otros grupos. Orquestador de cierre
// (F3-C), modalidad «sustitución por anuncio», condicionado a que la fila
// siga activa. -> true | false
async function sustituirEnGrupo({ db, evento, motivo }) {
    const { terminarFila } = require("../cerrarEvento");
    const instante = new Date().toISOString();

    const r = await terminarFila({
        db,
        fila: evento,
        modalidad: "sustitucion_anuncio",
        actor: "deteccion",
        cambios: { activo: false, estado: "cerrado", actualizado_en: instante, cierre_estado: "cerrado", cierre_motivo: motivo, cerrado_en: instante }
    });

    if (r.error) {
        console.error(`❌ No se pudo cerrar el sorteo anterior (${evento.id}) del grupo:`, r.error);
        return false;
    }

    console.log(`🔁 Sorteo anterior ${evento.nombre_evento || ""} ${evento.hora_fin || ""} cerrado en este grupo (${motivo}); sus reservas y pagos se conservan.`);
    return true;
}

module.exports = { reemplazarDelPrecio, sustituirEnGrupo };
