// ==========================================================================
// POLÍTICA DE GRUPOS AUTORIZADOS (aislamiento multiusuario, 2026-10-21)
//
// Un cliente SOLO actúa en los grupos que autorizó en el panel
// (grupos_autorizados: usuario_id + grupo_id + activo, migración 006).
// "Actuar" = procesar mensajes del grupo (historial, anuncios, reservas,
// consultas, pagos), ejecutar el worker de sus sorteos y expulsar
// participantes bloqueados.
//
// Falla cerrado: sin dueño de la sesión, o si no se puede leer la
// autorización (error de Supabase), el grupo se trata como NO autorizado.
//
// Caché por cliente de AUTORIZACION_TTL_MS: con N sesiones y mucho tráfico
// no se consulta la base por cada mensaje. Un grupo autorizado desde el panel
// empieza a procesarse como mucho tras ese tiempo; uno desautorizado deja de
// hacerlo igual.
// ==========================================================================

const supabase = require("../../../lib/supabase");

const AUTORIZACION_TTL_MS = 30 * 1000;

// usuarioId -> { hasta, grupos: Promise<Set<string> | null> }
const cache = new Map();

async function leerGrupos(usuarioId) {

    try {

        const { data, error } = await supabase
            .from("grupos_autorizados")
            .select("grupo_id")
            .eq("usuario_id", usuarioId)
            .eq("activo", true);

        if (error) {
            console.error("❌ [GRUPOS AUTORIZADOS] no se pudo leer la autorización (se rechaza):", error.code || error.message);
            return null;
        }

        return new Set((data || []).map(f => f.grupo_id));

    } catch (err) {

        console.error("❌ [GRUPOS AUTORIZADOS] excepción leyendo la autorización (se rechaza):", err?.message);
        return null;

    }

}

// Set de grupos autorizados del cliente, o null si no se pudo saber.
function gruposAutorizadosDe(usuarioId) {

    const ahora = Date.now();
    const vigente = cache.get(usuarioId);

    if (vigente && vigente.hasta > ahora) return vigente.grupos;

    const grupos = leerGrupos(usuarioId);

    // Un error no se cachea: el siguiente mensaje vuelve a intentarlo.
    cache.set(usuarioId, { hasta: ahora + AUTORIZACION_TTL_MS, grupos });
    grupos.then(g => { if (g === null) cache.delete(usuarioId); });

    return grupos;

}

// { permitido: boolean, motivo } — motivo: autorizado | sin_propietario |
// sin_grupo | autorizacion_desconocida | no_autorizado.
async function evaluarGrupo(usuarioId, grupoId) {

    if (!usuarioId) return { permitido: false, motivo: "sin_propietario" };
    if (!grupoId) return { permitido: false, motivo: "sin_grupo" };

    const grupos = await gruposAutorizadosDe(usuarioId);

    if (grupos === null) return { permitido: false, motivo: "autorizacion_desconocida" };

    return grupos.has(grupoId)
        ? { permitido: true, motivo: "autorizado" }
        : { permitido: false, motivo: "no_autorizado" };

}

// Tras autorizar/desautorizar desde el backend, o en pruebas.
function olvidarAutorizacion(usuarioId) {
    if (usuarioId) cache.delete(usuarioId);
    else cache.clear();
}

module.exports = {
    AUTORIZACION_TTL_MS,
    evaluarGrupo,
    gruposAutorizadosDe,
    olvidarAutorizacion
};
