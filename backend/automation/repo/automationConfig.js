// ==========================================================================
// repo/automationConfig.js — SOLO lectura/persistencia básica de
// automation_configs y grupos_autorizados.
//
// Por ahora, deliberadamente mínimo (Master Spec §8: "por ahora SOLO
// lectura y persistencia básica"). Sin reglas de negocio — eso vive en
// eventRules.js.
//
// grupos_autorizados no tenía un archivo de repositorio propio en la
// arquitectura pedida para esta fase (solo repo/eventSessions.js y
// repo/automationConfig.js) — su soporte mínimo vive aquí, junto a
// automation_configs, ya que ambas tablas se consultan siempre juntas al
// evaluar si un grupo puede operar (grupo autorizado + su configuración).
// ==========================================================================

const supabase = require("../../lib/supabase");

async function obtenerConfiguracion(usuarioId, grupoId) {

    const { data, error } = await supabase
        .from("automation_configs")
        .select("*")
        .eq("usuario_id", usuarioId)
        .eq("grupo_id", grupoId)
        .maybeSingle();

    if (error) throw error;

    return data;

}

async function estaGrupoAutorizado(usuarioId, grupoId) {

    const { data, error } = await supabase
        .from("grupos_autorizados")
        .select("*")
        .eq("usuario_id", usuarioId)
        .eq("grupo_id", grupoId)
        .eq("activo", true)
        .maybeSingle();

    if (error) throw error;

    return !!data;

}

module.exports = {
    obtenerConfiguracion,
    estaGrupoAutorizado
};
