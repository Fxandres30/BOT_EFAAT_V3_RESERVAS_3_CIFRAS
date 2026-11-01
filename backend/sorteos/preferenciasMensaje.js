// ==========================================================================
// sorteos/preferenciasMensaje.js — estilo de mensaje predeterminado DE CADA
// CUENTA (tabla preferencias_mensaje_sorteo, migración 042).
//
// Siempre filtrado por el usuario del token: una cuenta nunca lee ni cambia
// la preferencia de otra. Sin la migración 042 (o ante cualquier error de
// lectura) se usa el estilo clásico: crear un sorteo nunca se bloquea por
// esto. Guardar sin la 042 responde migracion_pendiente.
// ==========================================================================

const supabase = require("../lib/supabase");
const { ESTILO_PREDETERMINADO, esEstilo } = require("./estilosMensaje");

const TABLA = "preferencias_mensaje_sorteo";
// 42P01: relación inexistente (Postgres); PGRST205: tabla fuera del caché
// de esquema de PostgREST (la forma en que suele llegar por la API).
const SIN_TABLA = new Set(["42P01", "PGRST205"]);

// -> { ok: true, data: { estilo, disponible } }. Nunca falla.
async function obtener(usuarioId) {
    try {
        const { data, error } = await supabase.from(TABLA).select("estilo_predeterminado")
            .eq("usuario_id", usuarioId).maybeSingle();
        if (error) {
            if (!SIN_TABLA.has(error.code)) console.error("❌ [PREFERENCIAS MENSAJE] no se pudo leer:", error.message);
            return { ok: true, data: { estilo: ESTILO_PREDETERMINADO, disponible: !SIN_TABLA.has(error.code) } };
        }
        const estilo = esEstilo(data?.estilo_predeterminado) ? data.estilo_predeterminado : ESTILO_PREDETERMINADO;
        return { ok: true, data: { estilo, disponible: true } };
    } catch (err) {
        console.error("❌ [PREFERENCIAS MENSAJE] no se pudo leer:", err?.message);
        return { ok: true, data: { estilo: ESTILO_PREDETERMINADO, disponible: false } };
    }
}

async function estiloPredeterminado(usuarioId) {
    return (await obtener(usuarioId)).data.estilo;
}

async function guardar(usuarioId, estilo) {
    if (!esEstilo(estilo)) return { ok: false, motivo: "validacion", errores: [{ campo: "estilo", mensaje: "Ese diseño no existe." }] };
    const { data, error } = await supabase.from(TABLA)
        .upsert({ usuario_id: usuarioId, estilo_predeterminado: estilo, actualizado_en: new Date().toISOString() }, { onConflict: "usuario_id" })
        .select("estilo_predeterminado").maybeSingle();
    if (error) {
        if (SIN_TABLA.has(error.code)) return { ok: false, motivo: "migracion_pendiente", migracion: "042_preferencias_mensaje_sorteo.sql" };
        return { ok: false, motivo: "error_supabase", error: error.message };
    }
    return { ok: true, data: { estilo: data?.estilo_predeterminado || estilo, disponible: true } };
}

module.exports = { obtener, estiloPredeterminado, guardar, TABLA };
