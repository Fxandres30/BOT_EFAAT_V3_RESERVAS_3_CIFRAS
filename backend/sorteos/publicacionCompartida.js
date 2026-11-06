// ==========================================================================
// PUBLICACIÓN COMPARTIDA (F4-F.1, 06/11/2026): quién produjo la publicación
// de un sorteo en un grupo cuando dos programaciones del MISMO sorteo apuntan
// al mismo grupo (K3).
//
// Fuente ÚNICA de la relación: el reclamo PUBLICAR_SORTEO:<usuario>:<grupo>:
// <identidad> (sorteos/publicacionPorGrupo.js). Su detalle.sorteo_id es la
// programación PROPIETARIA; se guarda de forma atómica al adquirirlo y no
// cambia. Una programación cuyo destino está «publicado» en un grupo cuyo
// reclamo pertenece a OTRA programación es ADOPTANTE en ese grupo: su destino
// apunta a la misma fila del evento, pero ella no envió el anuncio y no
// gobierna sus comunicaciones (recordatorios, aviso de cierre, vencimiento).
// Sin migración y sin estados nuevos: los CHECK de 024 no cambian.
//
// Lo usan: publicador (procesarPublicados, liberarVencidas), gruposSorteo
// (programacionDeIdentidad, cambiarGrupos), sorteosActivos
// (sorteoProgramadoDe) y prioridadComunicaciones (sorteoDelEvento). Solo lee.
// ==========================================================================

"use strict";

const TIPO = "PUBLICAR_SORTEO";

const prefijo = (usuarioId) => `${TIPO}:${usuarioId}:`;
const grupoDeClave = (clave, usuarioId) => {
    const resto = String(clave).slice(prefijo(usuarioId).length);
    return resto.slice(0, resto.lastIndexOf(":"));
};

// Propietaria de la publicación de un sorteo por grupo: Map(grupo -> sorteo_id).
// Un error de lectura LANZA (nadie decide a ciegas).
async function propietariasPorGrupo(db, usuarioId, identidad) {
    const propietarias = new Map();
    if (!usuarioId || !identidad) return propietarias;
    const { data, error } = await db.from("automation_actions").select("*")
        .eq("tipo_accion", TIPO).eq("usuario_id", usuarioId)
        .like("clave_idempotencia", `${prefijo(usuarioId)}%:${identidad}`);
    if (error) throw new Error(`No se pudo leer quién publicó el sorteo: ${error.message}`);
    for (const a of data || []) {
        if (!String(a.clave_idempotencia).endsWith(`:${identidad}`) || /:retirada:/.test(a.clave_idempotencia)) continue;
        if (a.detalle?.sorteo_id) propietarias.set(grupoDeClave(a.clave_idempotencia, usuarioId), a.detalle.sorteo_id);
    }
    return propietarias;
}

// Grupos en los que ESTA programación adopta la publicación de otra.
// destinos: los suyos (sorteos_programados_grupos). -> Set(grupo_id)
async function gruposAdoptados(db, sorteo, destinos) {
    const publicados = (destinos || []).filter(g => g.estado === "publicado");
    if (!publicados.length) return new Set();
    const propietarias = await propietariasPorGrupo(db, sorteo.usuario_id, sorteo.identidad_evento_real);
    return new Set(publicados.filter(g => propietarias.has(g.grupo_id) && propietarias.get(g.grupo_id) !== sorteo.id).map(g => g.grupo_id));
}

// ¿Es PURA adoptante (todo lo que tiene publicado lo publicó otra)?
async function esPuraAdoptante(db, sorteo, destinos) {
    const publicados = (destinos || []).filter(g => g.estado === "publicado");
    if (!publicados.length) return false;
    return (await gruposAdoptados(db, sorteo, destinos)).size === publicados.length;
}

// ==========================================================================
// Criterio ÚNICO de «la programación de un sorteo» (antes repetido en tres
// sitios): la más reciente que no esté cancelada, SALVO que sea pura
// adoptante y haya otra candidata. Con una sola candidata (lo habitual) no se
// lee nada más: el resultado es exactamente el de siempre. Lo que cada uso
// hace con una archivada (devolver null o no) lo sigue decidiendo él.
//   candidatas: filas de sorteos_programados de la identidad, sin canceladas,
//               de la más reciente a la más antigua.
// ==========================================================================
async function elegirProgramacion(db, usuarioId, candidatas) {
    const vivas = candidatas || [];
    if (vivas.length <= 1) return vivas[0] || null;
    try {
        const ids = vivas.map(p => p.id);
        const { data: destinos, error } = await db.from("sorteos_programados_grupos").select("*")
            .eq("usuario_id", usuarioId).in("sorteo_id", ids);
        if (error) return vivas[0];
        const propietarias = await propietariasPorGrupo(db, usuarioId, vivas[0].identidad_evento_real);
        const adoptante = (p) => {
            const pub = (destinos || []).filter(g => g.sorteo_id === p.id && g.estado === "publicado");
            return pub.length > 0 && pub.every(g => propietarias.has(g.grupo_id) && propietarias.get(g.grupo_id) !== p.id);
        };
        return vivas.find(p => !adoptante(p)) || vivas[0];
    } catch {
        return vivas[0];
    }
}

module.exports = { propietariasPorGrupo, gruposAdoptados, esPuraAdoptante, elegirProgramacion, TIPO };
