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

// Archivar / restaurar (columna archivado_en, migración 038), condicionado
// al estado leído y a que no lo haya hecho otra petición antes.
async function marcarArchivado(usuarioId, id, { estado, archivado, ahora = new Date() }) {

    let query = supabase.from("sorteos_programados")
        .update({ archivado_en: archivado ? ahora.toISOString() : null, actualizado_en: new Date().toISOString() })
        .eq("usuario_id", usuarioId).eq("id", id).eq("estado", estado);

    query = archivado ? query.is("archivado_en", null) : query.not("archivado_en", "is", null);

    const { data, error } = await query.select("id");

    // Columna inexistente (Postgres o PostgREST): la 038 no está aplicada.
    if (error && ["42703", "PGRST204"].includes(error.code)) return { ok: false, motivo: "migracion_pendiente", migracion: "038" };
    if (error) return resultado(null, error);

    return data?.length ? { ok: true, data: data[0] } : { ok: false, motivo: "conflicto" };

}

// DELETE condicionado, igual que actualizarSorteoSi. Los grupos se borran
// en cascada (FK de la 024); el segundo DELETE solo limpia por si acaso.
async function eliminarSorteoSi(usuarioId, id, { version, estados }) {

    let query = supabase.from("sorteos_programados").delete()
        .eq("usuario_id", usuarioId).eq("id", id).eq("version", version);

    if (estados?.length) query = query.in("estado", estados);

    const { data, error } = await query.select("id");

    if (error) return resultado(null, error);
    if (!data?.length) return { ok: false, motivo: "conflicto" };

    await supabase.from("sorteos_programados_grupos").delete().eq("usuario_id", usuarioId).eq("sorteo_id", id);

    return { ok: true, data: data[0] };

}

async function gruposDelSorteo(usuarioId, sorteoId) {
    const { data, error } = await supabase.from("sorteos_programados_grupos").select("*")
        .eq("usuario_id", usuarioId).eq("sorteo_id", sorteoId).order("creado_en", { ascending: true });
    return resultado(data || [], error);
}

// Grupos de varios sorteos en una sola consulta (listado del panel).
async function gruposDeSorteos(usuarioId, sorteoIds) {
    if (!sorteoIds.length) return { ok: true, data: [] };
    const { data, error } = await supabase.from("sorteos_programados_grupos").select("*")
        .eq("usuario_id", usuarioId).in("sorteo_id", sorteoIds).order("creado_en", { ascending: true });
    return resultado(data || [], error);
}

// Filas de eventos_bot del cliente con esas identidades (el sorteo ya
// existe en esos grupos, abierto o cerrado).
async function eventosPorIdentidad(usuarioId, identidades) {
    if (!identidades.length) return { ok: true, data: [] };
    const { data, error } = await supabase.from("eventos_bot").select("*")
        .eq("usuario_id", usuarioId).in("identidad_evento_real", identidades);
    return resultado(data || [], error);
}

// Números NO libres de esas identidades en una tabla física del cliente.
async function numerosPorIdentidad(usuarioId, tabla, identidades) {
    if (!tabla || !identidades.length) return { ok: true, data: [] };
    const { data, error } = await supabase.from(tabla).select("identidad_evento_real, estado")
        .eq("usuario_id", usuarioId).in("identidad_evento_real", identidades).neq("estado", "libre");
    return resultado(data || [], error);
}

// ---------------------------------------------- historial (migración 038) ---

// Anuncios de sorteos programados que pasaron por el ExecutionGuard
// (compartirEnGrupos, clave ...:sorteo-<id>-publicacion-<n>:<grupo>).
async function enviosDeSorteos(usuarioId) {
    const { data, error } = await supabase.from("automation_actions").select("clave_idempotencia, estado")
        .eq("usuario_id", usuarioId).eq("tipo_accion", "TABLA_COMPARTIR").like("clave_idempotencia", "%:sorteo-%");
    return resultado(data || [], error);
}

// Registro de lo que hizo el administrador (cancelar, eliminar, archivar…)
// con el resultado REAL. Sin la 038 queda en el log del proceso; nunca
// hace fallar la operación, que ya se hizo.
async function registrarHistorial(usuarioId, sorteoId, accion, resultadoAccion, detalle = {}) {
    const fila = { usuario_id: usuarioId, sorteo_id: sorteoId, accion, resultado: resultadoAccion, detalle };
    try {
        const { error } = await supabase.from("sorteos_programados_historial").insert(fila);
        if (!error) return;
        console.log(`📝 [SORTEOS HISTORIAL] (sin guardar: ${error.code || error.message}) ${JSON.stringify(fila)}`);
    } catch (err) {
        console.log(`📝 [SORTEOS HISTORIAL] (sin guardar: ${err?.message}) ${JSON.stringify(fila)}`);
    }
}

async function historialDelSorteo(usuarioId, sorteoId) {
    const { data, error } = await supabase.from("sorteos_programados_historial").select("*")
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

// Como marcarGrupo, pero solo si el grupo sigue en uno de esos estados:
// una cancelación y el publicador nunca se pisan. data = ¿se cambió?
async function marcarGrupoSi(usuarioId, filaId, estados, cambios) {
    const { data, error } = await supabase.from("sorteos_programados_grupos")
        .update({ ...cambios, actualizado_en: new Date().toISOString() })
        .eq("usuario_id", usuarioId).eq("id", filaId).in("estado", estados)
        .select("id");
    return resultado((data || []).length > 0, error);
}

// Estados de un sorteo programado cuya fila de eventos_bot ya puede existir.
const ESTADOS_CON_EVENTO = ["publicando", "publicado", "publicado_parcial", "fallido"];

// ¿Esta fila de eventos_bot nació de un sorteo programado vigente? Lo usa
// el detector para no reemplazar un sorteo manual activo.
//
// `evento`: la fila (o solo su id, como antes). Con la fila se reconoce por
// su IDENTIDAD en sorteos_programados del mismo cliente, no solo por el
// enlace evento_bot_id de un grupo en estado 'publicado': ese enlace se
// escribe DESPUÉS del envío y un anuncio con resultado incierto deja el
// grupo en 'requiere_revision'. En ambos casos el anuncio ya puede estar en
// el grupo y volver a leerse.
async function esEventoDeSorteoProgramado(evento) {

    const eventoBotId = typeof evento === "object" ? evento?.id : evento;
    if (!eventoBotId) return false;

    // La detección de sorteos NUNCA puede fallar por esta consulta auxiliar:
    // ante cualquier error (migración 024 sin aplicar, red, excepción) se
    // responde "no", que es exactamente el comportamiento previo a esta fase.
    try {

        const { data, error } = await supabase.from("sorteos_programados_grupos")
            .select("id, estado").eq("evento_bot_id", eventoBotId).neq("estado", "cancelado").limit(1);

        if (error) return false;
        if ((data || []).length > 0) return true;

        if (typeof evento !== "object" || !evento?.usuario_id || !evento?.identidad_evento_real) return false;

        const porIdentidad = await supabase.from("sorteos_programados")
            .select("id").eq("usuario_id", evento.usuario_id).eq("identidad_evento_real", evento.identidad_evento_real)
            .in("estado", ESTADOS_CON_EVENTO).limit(1);

        if (porIdentidad.error) return false;

        return (porIdentidad.data || []).length > 0;

    } catch (err) {

        console.error("⚠️ No se pudo comprobar si el evento es de un sorteo programado (se sigue el flujo de siempre):", err?.message);
        return false;

    }

}

// ------------------------------------------------- diseño y números ---

// Diseño de la biblioteca DEL USUARIO (tabla_disenos, 010). Ajeno = null.
async function obtenerDisenoPropio(usuarioId, id) {
    const { data, error } = await supabase.from("tabla_disenos").select("id, nombre, config")
        .eq("usuario_id", usuarioId).eq("id", id).maybeSingle();
    return resultado(data, error);
}

// Diseño activo de la tabla de ese precio (tabla_configuracion_visual, 010).
async function obtenerConfigVisual(usuarioId, precio) {
    const { data, error } = await supabase.from("tabla_configuracion_visual").select("config, diseno_origen_id")
        .eq("usuario_id", usuarioId).eq("precio", precio).maybeSingle();
    return resultado(data, error);
}

// Estilo guardado en el sorteo programado que originó ESE evento del
// cliente (eventos_bot.id -> identidad_evento_real -> sorteos_programados).
// Todo filtrado por usuario_id: un evento o sorteo ajeno da null. Sin
// sorteo programado (evento creado a mano) también null.
async function disenoDelEvento(usuarioId, eventoId) {
    const { data: evento, error } = await supabase.from("eventos_bot").select("identidad_evento_real")
        .eq("usuario_id", usuarioId).eq("id", eventoId).maybeSingle();
    if (error || !evento?.identidad_evento_real) return resultado(null, error);
    const { data, error: errorSorteo } = await supabase.from("sorteos_programados").select("config")
        .eq("usuario_id", usuarioId).eq("identidad_evento_real", evento.identidad_evento_real)
        .order("creado_en", { ascending: false }).limit(1);
    return resultado(data?.[0]?.config?.diseno || null, errorSorteo);
}

// Número + estado de la cuadrícula del cliente (sin datos personales).
async function estadoNumeros(usuarioId, tabla) {
    const { data, error } = await supabase.from(tabla).select("numero, estado, identidad_evento_real")
        .eq("usuario_id", usuarioId).order("numero", { ascending: true });
    return resultado(data, error);
}

module.exports = {
    gruposAutorizados,
    obtenerDisenoPropio,
    obtenerConfigVisual,
    disenoDelEvento,
    estadoNumeros,
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
    eliminarSorteoSi,
    enviosDeSorteos,
    marcarArchivado,
    gruposDelSorteo,
    gruposDeSorteos,
    eventosPorIdentidad,
    numerosPorIdentidad,
    registrarHistorial,
    historialDelSorteo,
    reemplazarGrupos,
    sorteosParaPublicar,
    sorteosPublicados,
    reclamarGrupo,
    marcarGrupo,
    marcarGrupoSi,
    esEventoDeSorteoProgramado
};
