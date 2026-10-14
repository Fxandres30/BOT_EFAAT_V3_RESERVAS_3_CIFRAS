// ==========================================================================
// sorteos/repo.js — acceso a datos de sorteos programados, plantillas y
// cuentas de pago (migración 024).
//
// AISLAMIENTO: cada función recibe el usuarioId del TOKEN (nunca del
// navegador) y lo usa como filtro en TODA consulta. Un id ajeno se comporta
// como inexistente: nunca se revela que existe.
// ==========================================================================

const supabase = require("../lib/supabase");

const TABLA_NO_EXISTE = "42P01";

function resultado(data, error) {
    if (error) {
        return {
            ok: false,
            error: error.message,
            motivo: error.code === TABLA_NO_EXISTE ? "migracion_pendiente" : "error_supabase"
        };
    }
    return { ok: true, data };
}

// ------------------------------------------------------------- grupos ---

// Grupos que este cliente autorizó en el panel (grupos_autorizados, 006),
// con su nombre si el bot ya lo sincronizó (tabla grupos).
async function gruposAutorizados(usuarioId) {

    const { data, error } = await supabase
        .from("grupos_autorizados")
        .select("grupo_id")
        .eq("usuario_id", usuarioId)
        .eq("activo", true);

    if (error) return resultado(null, error);

    const ids = (data || []).map(f => f.grupo_id);
    let nombres = new Map();

    if (ids.length) {
        const { data: grupos } = await supabase.from("grupos").select("jid, nombre").in("jid", ids);
        nombres = new Map((grupos || []).map(g => [g.jid, g.nombre]));
    }

    return { ok: true, data: ids.map(id => ({ grupo_id: id, nombre: nombres.get(id) || null })) };

}

// Resumen para el formulario: cuántos grupos tiene registrados este cliente
// (activos o no) en grupos_autorizados. Distingue "no hay grupos" de "hay
// grupos pero ninguno autorizado".
async function resumenGrupos(usuarioId) {

    const { data, error } = await supabase
        .from("grupos_autorizados")
        .select("grupo_id, activo")
        .eq("usuario_id", usuarioId);

    if (error) return resultado(null, error);

    const filas = data || [];
    return { ok: true, data: { registrados: filas.length, autorizados: filas.filter(f => f.activo).length } };

}

// ------------------------------------------------------ cuentas de pago ---

const COLUMNAS_CUENTA = "id, nombre, tipo, titular, numero, instrucciones, activa, creado_en, actualizado_en";

async function listarCuentas(usuarioId) {
    const { data, error } = await supabase.from("cuentas_pago").select(COLUMNAS_CUENTA)
        .eq("usuario_id", usuarioId).order("creado_en", { ascending: true });
    return resultado(data || [], error);
}

async function cuentasActivasPorId(usuarioId, ids) {
    if (!ids?.length) return { ok: true, data: [] };
    const { data, error } = await supabase.from("cuentas_pago").select(COLUMNAS_CUENTA)
        .eq("usuario_id", usuarioId).eq("activa", true).in("id", ids);
    return resultado(data || [], error);
}

async function crearCuenta(usuarioId, cuenta) {
    const { data, error } = await supabase.from("cuentas_pago")
        .insert({ ...cuenta, usuario_id: usuarioId }).select(COLUMNAS_CUENTA).single();
    return resultado(data, error);
}

async function actualizarCuenta(usuarioId, id, cambios) {
    const { data, error } = await supabase.from("cuentas_pago")
        .update({ ...cambios, actualizado_en: new Date().toISOString() })
        .eq("usuario_id", usuarioId).eq("id", id).select(COLUMNAS_CUENTA);
    if (error) return resultado(null, error);
    return data?.length ? { ok: true, data: data[0] } : { ok: false, motivo: "no_encontrado" };
}

// ----------------------------------------------------------- plantillas ---

async function listarPlantillas(usuarioId) {
    const { data, error } = await supabase.from("plantillas_sorteo").select("*")
        .eq("usuario_id", usuarioId).eq("activa", true).order("nombre", { ascending: true });
    return resultado(data || [], error);
}

async function obtenerPlantilla(usuarioId, id) {
    const { data, error } = await supabase.from("plantillas_sorteo").select("*")
        .eq("usuario_id", usuarioId).eq("id", id).maybeSingle();
    if (error) return resultado(null, error);
    return data ? { ok: true, data } : { ok: false, motivo: "no_encontrado" };
}

async function crearPlantilla(usuarioId, { nombre, config }) {
    const { data, error } = await supabase.from("plantillas_sorteo")
        .insert({ usuario_id: usuarioId, nombre, config }).select().single();
    if (error?.code === "23505") return { ok: false, motivo: "nombre_duplicado" };
    return resultado(data, error);
}

async function actualizarPlantilla(usuarioId, id, cambios) {
    const { data, error } = await supabase.from("plantillas_sorteo")
        .update({ ...cambios, actualizado_en: new Date().toISOString() })
        .eq("usuario_id", usuarioId).eq("id", id).select();
    if (error?.code === "23505") return { ok: false, motivo: "nombre_duplicado" };
    if (error) return resultado(null, error);
    return data?.length ? { ok: true, data: data[0] } : { ok: false, motivo: "no_encontrado" };
}

// -------------------------------------------------------------- sorteos ---

async function crearSorteo(usuarioId, fila) {
    const { data, error } = await supabase.from("sorteos_programados")
        .insert({ ...fila, usuario_id: usuarioId }).select().single();
    return resultado(data, error);
}

async function obtenerSorteo(usuarioId, id) {

    const { data, error } = await supabase.from("sorteos_programados").select("*")
        .eq("usuario_id", usuarioId).eq("id", id).maybeSingle();

    if (error) return resultado(null, error);
    if (!data) return { ok: false, motivo: "no_encontrado" };

    const grupos = await gruposDelSorteo(usuarioId, id);

    if (!grupos.ok) return grupos;

    return { ok: true, data: { ...data, grupos: grupos.data } };

}

async function listarSorteos(usuarioId) {
    const { data, error } = await supabase.from("sorteos_programados").select("*")
        .eq("usuario_id", usuarioId).order("publicar_en", { ascending: false }).limit(200);
    return resultado(data || [], error);
}

// UPDATE condicionado (control optimista): solo si la versión y el estado
// son los esperados. Devuelve la fila o { motivo: "conflicto" }.
async function actualizarSorteoSi(usuarioId, id, { version, estados }, cambios) {

    let query = supabase.from("sorteos_programados")
        .update({ ...cambios, actualizado_en: new Date().toISOString() })
        .eq("usuario_id", usuarioId).eq("id", id);

    if (version !== undefined) query = query.eq("version", version);
    if (estados?.length) query = query.in("estado", estados);

    const { data, error } = await query.select();

    if (error) return resultado(null, error);

    return data?.length ? { ok: true, data: data[0] } : { ok: false, motivo: "conflicto" };

}

async function gruposDelSorteo(usuarioId, sorteoId) {
    const { data, error } = await supabase.from("sorteos_programados_grupos").select("*")
        .eq("usuario_id", usuarioId).eq("sorteo_id", sorteoId).order("creado_en", { ascending: true });
    return resultado(data || [], error);
}

// Sustituye los grupos de un sorteo que TODAVÍA no publicó en ninguno.
async function reemplazarGrupos(usuarioId, sorteoId, grupos) {

    const actuales = await gruposDelSorteo(usuarioId, sorteoId);
    if (!actuales.ok) return actuales;

    if (actuales.data.some(g => g.estado !== "pendiente" && g.estado !== "cancelado")) {
        return { ok: false, motivo: "ya_publicado" };
    }

    const { error: errorBorrado } = await supabase.from("sorteos_programados_grupos")
        .delete().eq("usuario_id", usuarioId).eq("sorteo_id", sorteoId);
    if (errorBorrado) return resultado(null, errorBorrado);

    if (!grupos.length) return { ok: true, data: [] };

    const { data, error } = await supabase.from("sorteos_programados_grupos")
        .insert(grupos.map(g => ({ sorteo_id: sorteoId, usuario_id: usuarioId, grupo_id: g.grupo_id, grupo_nombre: g.nombre || null })))
        .select();

    return resultado(data || [], error);

}

// ------------------------------------------------------------- worker ---

async function sorteosParaPublicar(usuarioId, ahora = new Date()) {
    const { data, error } = await supabase.from("sorteos_programados").select("*")
        .eq("usuario_id", usuarioId).in("estado", ["programado", "publicando"])
        .lte("publicar_en", ahora.toISOString());
    return resultado(data || [], error);
}

async function sorteosPublicados(usuarioId) {
    const { data, error } = await supabase.from("sorteos_programados").select("*")
        .eq("usuario_id", usuarioId).in("estado", ["publicado", "publicado_parcial"]);
    return resultado(data || [], error);
}

// Reclama UN grupo para publicarlo: solo si sigue 'pendiente' o 'fallido'.
// Dos ciclos (o dos procesos) nunca pueden publicar el mismo grupo a la vez.
async function reclamarGrupo(usuarioId, filaId, intentosPrevios) {

    const { data, error } = await supabase.from("sorteos_programados_grupos")
        .update({ estado: "publicando", intentos: (intentosPrevios || 0) + 1, actualizado_en: new Date().toISOString() })
        .eq("usuario_id", usuarioId).eq("id", filaId).in("estado", ["pendiente", "fallido"])
        .select();

    if (error) return resultado(null, error);

    return data?.length ? { ok: true, data: data[0] } : { ok: false, motivo: "no_disponible" };

}

async function marcarGrupo(usuarioId, filaId, cambios) {
    const { error } = await supabase.from("sorteos_programados_grupos")
        .update({ ...cambios, actualizado_en: new Date().toISOString() })
        .eq("usuario_id", usuarioId).eq("id", filaId);
    return resultado(true, error);
}

// ¿Esta fila de eventos_bot nació de un sorteo programado vigente? Lo usa
// el detector para no reemplazar un sorteo manual activo.
async function esEventoDeSorteoProgramado(eventoBotId) {

    if (!eventoBotId) return false;

    // La detección de sorteos NUNCA puede fallar por esta consulta auxiliar:
    // ante cualquier error (migración 024 sin aplicar, red, excepción) se
    // responde "no", que es exactamente el comportamiento previo a esta fase.
    try {

        const { data, error } = await supabase.from("sorteos_programados_grupos")
            .select("id, estado").eq("evento_bot_id", eventoBotId).eq("estado", "publicado").limit(1);

        if (error) return false;

        return (data || []).length > 0;

    } catch (err) {

        console.error("⚠️ No se pudo comprobar si el evento es de un sorteo programado (se sigue el flujo de siempre):", err?.message);
        return false;

    }

}

module.exports = {
    gruposAutorizados,
    resumenGrupos,
    listarCuentas,
    cuentasActivasPorId,
    crearCuenta,
    actualizarCuenta,
    listarPlantillas,
    obtenerPlantilla,
    crearPlantilla,
    actualizarPlantilla,
    crearSorteo,
    obtenerSorteo,
    listarSorteos,
    actualizarSorteoSi,
    gruposDelSorteo,
    reemplazarGrupos,
    sorteosParaPublicar,
    sorteosPublicados,
    reclamarGrupo,
    marcarGrupo,
    esEventoDeSorteoProgramado
};
