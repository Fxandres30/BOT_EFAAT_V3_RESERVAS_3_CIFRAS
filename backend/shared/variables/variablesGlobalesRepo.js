// ==========================================================================
// Acceso a datos de variables_globales (Supabase). SOLO lectura/escritura de
// esta tabla — no es un segundo catálogo ni un segundo resolver, es la capa
// de datos que alimenta a catalogoVariables.js/resolverVariables.js con las
// variables que el admin creó desde el panel. Mismo patrón que cualquier
// otro repo de este proyecto (p. ej. automation/repo/*.js).
//
// Toda función es best-effort desde el punto de vista del CHAT real: si la
// migración 017 todavía no se aplicó (tabla inexistente, error 42P01) o
// Supabase falla por cualquier motivo, se devuelve una lista vacía en vez
// de propagar el error — el mismo criterio de "red de seguridad de
// despliegue" ya usado en la Fase Identidad Real (ver
// bot/funciones/eventos/guardarEvento.js). Nunca debe romper un mensaje
// real por esta característica todavía opcional.
// ==========================================================================

const supabase = require("../../lib/supabase");

const CODIGO_TABLA_INEXISTENTE = "42P01";

// Trae las variables ACTIVAS de un usuario — usado por el resolver real de
// mensajes (nunca las inactivas: una variable desactivada debe comportarse
// como si no existiera, igual que una plantilla deshabilitada).
async function obtenerVariablesActivas(usuarioId) {

    if (!usuarioId) return [];

    try {

        const { data, error } = await supabase
            .from("variables_globales")
            .select("*")
            .eq("usuario_id", usuarioId)
            .eq("activa", true);

        if (error) {

            if (error.code !== CODIGO_TABLA_INEXISTENTE) {
                console.error("❌ Error leyendo variables_globales:", error.message);
            }

            return [];

        }

        return data || [];

    } catch (error) {

        console.error("❌ Excepción leyendo variables_globales:", error?.message);
        return [];

    }

}

// Trae TODAS las variables del usuario (activas e inactivas) — usado por el
// panel de administración (listar/buscar/editar), donde sí interesa ver las
// desactivadas.
async function listarVariables(usuarioId) {

    return supabase
        .from("variables_globales")
        .select("*")
        .eq("usuario_id", usuarioId)
        .order("created_at", { ascending: true });

}

async function crearVariable(usuarioId, datos) {

    return supabase
        .from("variables_globales")
        .insert({
            usuario_id: usuarioId,
            identificador: datos.identificador,
            nombre_visible: datos.nombre_visible,
            tipo: datos.tipo,
            singular: datos.singular ?? null,
            plural: datos.plural ?? null,
            valor: datos.valor ?? null,
            categoria: datos.categoria || "PERSONALIZADA",
            descripcion: datos.descripcion || "",
            ejemplo: datos.ejemplo || "",
            activa: datos.activa !== false
        })
        .select()
        .single();

}

async function actualizarVariable(id, usuarioId, cambios) {

    return supabase
        .from("variables_globales")
        .update({
            ...cambios,
            updated_at: new Date().toISOString()
        })
        .eq("id", id)
        .eq("usuario_id", usuarioId)
        .select()
        .single();

}

async function eliminarVariable(id, usuarioId) {

    return supabase
        .from("variables_globales")
        .delete()
        .eq("id", id)
        .eq("usuario_id", usuarioId);

}

// Cuenta cuántas plantillas (de este usuario) mencionan {{identificador}} —
// con o sin modificador ("|upper", etc.) — para advertir antes de eliminar.
// No decide nada por su cuenta: solo informa; quien llama decide si
// bloquea o solo advierte.
async function contarUsoEnPlantillas(usuarioId, identificador) {

    const { data, error, count } = await supabase
        .from("plantillas_mensaje")
        .select("id", { count: "exact" })
        .eq("usuario_id", usuarioId)
        .ilike("contenido", `%{{${identificador}%`);

    if (error) {
        return { count: null, error };
    }

    return { count: count ?? (data ? data.length : 0), error: null };

}

module.exports = {
    obtenerVariablesActivas,
    listarVariables,
    crearVariable,
    actualizarVariable,
    eliminarVariable,
    contarUsoEnPlantillas
};
