// ==========================================================================
// bloqueadosRepo.js — capa de datos del BLOQUEO AUTOMÁTICO DE WHATSAPP (ver
// supabase_migrations/019_bloqueo_whatsapp.sql).
// ==========================================================================
// UN SOLO CONCEPTO DE NEGOCIO: "bloqueado" — no existe un concepto separado
// de "veto". Bloquear un contacto significa, a la vez: no puede usar el
// bot, no puede reservar, y si entra a cualquier grupo administrado por el
// bot se expulsa automáticamente (ver bloqueoParticipantesGrupo.js).
//
// Este archivo NO decide identidad ni resuelve LID/teléfono — solo
// persiste/consulta lo que el llamador ya resolvió (mismo criterio que
// escanerIdentidades.js — no reimplementa nada de identityScanner).
// ==========================================================================

const supabase = require("../../../lib/supabase");
const { olvidarBloqueos } = require("./bloqueoActivo");

const VIOLACION_UNICA = "23505";

// PostgREST no distingue "la tabla no existe" de otros errores con un campo
// simple — el código real es "42P01" (undefined_table). Se usa para dar un
// mensaje claro mientras la migración 019 no se haya aplicado todavía, en
// vez de un error genérico de Supabase.
const TABLA_NO_EXISTE = "42P01";

function migracionPendiente(error) {
    return !!error && error.code === TABLA_NO_EXISTE;
}

// ==========================================================================
// crearBloqueo({ usuarioId, telefono, lid, jid, nombre, motivo, bloqueadoPor })
// ==========================================================================
// "🚫 BLOQUEAR CONTACTO". Si ya existe un registro (activo o inactivo) para
// este teléfono o este LID, bajo el mismo tenant, lo REACTIVA/actualiza en
// vez de insertar uno nuevo (evita duplicados y respeta los índices únicos
// parciales de la migración 019, que son por teléfono y por LID). Nunca
// borra/pierde los contadores (intentos_ingreso/expulsiones/último grupo)
// de un bloqueo previo sobre la misma persona: volver a bloquear no
// reinicia su historial.
// ==========================================================================
// Devuelve también `yaActivo`: el contacto YA estaba bloqueado (segundo clic
// o petición repetida) — quien llama no debe reiniciar nada.
async function crearBloqueo(datos, { reintentoPorCarrera = false } = {}) {

    const { usuarioId, telefono, lid, jid, nombre, motivo, bloqueadoPor } = datos;

    if (!usuarioId) return { ok: false, motivo: "falta_usuario_id" };

    if (!telefono && !lid && !jid) {
        return { ok: false, motivo: "sin_identificador" };
    }

    const orCondiciones = [];
    if (telefono) orCondiciones.push(`telefono.eq.${telefono}`);
    if (lid) orCondiciones.push(`lid.eq.${lid}`);

    let existente = null;

    if (orCondiciones.length > 0) {

        const { data, error } = await supabase
            .from("bloqueados")
            .select("*")
            .eq("usuario_id", usuarioId)
            .or(orCondiciones.join(","));

        if (error) {
            if (migracionPendiente(error)) return { ok: false, motivo: "migracion_pendiente", error: error.message };
            return { ok: false, motivo: "error_supabase", error: error.message };
        }

        // Si hay varias (una activa y otras históricas), manda la activa.
        existente = (data || []).find(f => f.activo) || (data || [])[0] || null;

    }

    if (existente) {

        const { data, error } = await supabase
            .from("bloqueados")
            .update({
                telefono: telefono || existente.telefono,
                lid: lid || existente.lid,
                jid: jid || existente.jid,
                nombre: nombre || existente.nombre,
                motivo: motivo || existente.motivo,
                bloqueado_por: bloqueadoPor || existente.bloqueado_por,
                activo: true,
                actualizado_en: new Date().toISOString()
            })
            .eq("id", existente.id)
            .select()
            .single();

        if (error) return { ok: false, motivo: "error_supabase", error: error.message };

        olvidarBloqueos(usuarioId);

        return { ok: true, bloqueado: data, reactivado: true, yaActivo: existente.activo === true };

    }

    const { data, error } = await supabase
        .from("bloqueados")
        .insert({
            usuario_id: usuarioId,
            telefono: telefono || null,
            lid: lid || null,
            jid: jid || null,
            nombre: nombre || null,
            motivo: motivo || null,
            bloqueado_por: bloqueadoPor || null,
            activo: true
        })
        .select()
        .single();

    if (error) {

        if (migracionPendiente(error)) return { ok: false, motivo: "migracion_pendiente", error: error.message };

        // Dos bloqueos simultáneos del mismo contacto (doble clic): el índice
        // único de la 019 rechaza el segundo INSERT. No es un error: se relee
        // y se responde con el bloqueo que ganó.
        if (error.code === VIOLACION_UNICA && !reintentoPorCarrera) return crearBloqueo(datos, { reintentoPorCarrera: true });

        return { ok: false, motivo: "error_supabase", error: error.message };

    }

    olvidarBloqueos(usuarioId);

    return { ok: true, bloqueado: data, reactivado: false, yaActivo: false };

}

// ==========================================================================
// desbloquear(id, usuarioId) — "🔓 DESBLOQUEAR CONTACTO". Desactiva
// (activo=false). Nunca borra la fila: conserva el historial
// (intentos_ingreso/expulsiones) por si se vuelve a bloquear más adelante,
// y para que el panel pueda seguir mostrando "bloqueado anteriormente" si
// algún día lo necesita.
// ==========================================================================
async function desbloquear(id, usuarioId) {

    if (!id || !usuarioId) return { ok: false, motivo: "faltan_parametros" };

    const { data, error } = await supabase
        .from("bloqueados")
        .update({ activo: false, actualizado_en: new Date().toISOString() })
        .eq("id", id)
        .eq("usuario_id", usuarioId)
        .select()
        .single();

    if (error) {

        if (migracionPendiente(error)) return { ok: false, motivo: "migracion_pendiente", error: error.message };

        // .single() sobre 0 filas actualizadas -> PGRST116 (ver fakeSupabase.js
        // y el comportamiento real de supabase-js): significa "no existe ese
        // bloqueo para este tenant", no un error de infraestructura.
        if (error.code === "PGRST116") return { ok: false, motivo: "bloqueo_no_existe" };

        return { ok: false, motivo: "error_supabase", error: error.message };

    }

    olvidarBloqueos(usuarioId);

    return { ok: true, bloqueado: data };

}

// ==========================================================================
// listarBloqueados(usuarioId) — para el panel (lista de bloqueados).
// ==========================================================================
async function listarBloqueados(usuarioId) {

    if (!usuarioId) return { ok: false, motivo: "falta_usuario_id", bloqueados: [] };

    const { data, error } = await supabase
        .from("bloqueados")
        .select("*")
        .eq("usuario_id", usuarioId)
        .order("creado_en", { ascending: false });

    if (error) {

        if (migracionPendiente(error)) return { ok: false, motivo: "migracion_pendiente", bloqueados: [] };
        return { ok: false, motivo: "error_supabase", error: error.message, bloqueados: [] };

    }

    return { ok: true, bloqueados: data || [] };

}

// ==========================================================================
// obtenerBloqueoDeContacto(usuarioId, { telefono, lid }) — para el badge
// "🚫 CONTACTO BLOQUEADO" en el detalle de un contacto del panel. Solo
// importa el bloqueo ACTIVO más reciente (si hay uno inactivo previo, el
// contacto no está bloqueado ahora mismo).
// ==========================================================================
async function obtenerBloqueoDeContacto(usuarioId, { telefono, lid } = {}) {

    if (!usuarioId || (!telefono && !lid)) return { ok: true, bloqueado: null };

    const orCondiciones = [];
    if (telefono) orCondiciones.push(`telefono.eq.${telefono}`);
    if (lid) orCondiciones.push(`lid.eq.${lid}`);

    const { data, error } = await supabase
        .from("bloqueados")
        .select("*")
        .eq("usuario_id", usuarioId)
        .eq("activo", true)
        .or(orCondiciones.join(","));

    if (error) {

        if (migracionPendiente(error)) return { ok: true, bloqueado: null }; // migración no aplicada aún -> tratar como "sin bloqueo", nunca romper el perfil del contacto
        return { ok: false, motivo: "error_supabase", error: error.message, bloqueado: null };

    }

    return { ok: true, bloqueado: (data || [])[0] || null };

}

// ==========================================================================
// buscarBloqueoActivo(usuarioId, { telefono, lid, jid }) — núcleo del
// bloqueo automático: ¿este participante que acaba de entrar a un grupo
// está bloqueado? Empareja por CUALQUIERA de los tres identificadores
// disponibles (teléfono, LID o jid crudo).
// ==========================================================================
async function buscarBloqueoActivo(usuarioId, { telefono, lid, jid } = {}) {

    if (!usuarioId || (!telefono && !lid && !jid)) return { ok: true, bloqueado: null };

    const orCondiciones = [];
    if (telefono) orCondiciones.push(`telefono.eq.${telefono}`);
    if (lid) orCondiciones.push(`lid.eq.${lid}`);
    if (jid) orCondiciones.push(`jid.eq.${jid}`);

    const { data, error } = await supabase
        .from("bloqueados")
        .select("*")
        .eq("usuario_id", usuarioId)
        .eq("activo", true)
        .or(orCondiciones.join(","));

    if (error) {

        if (migracionPendiente(error)) return { ok: true, bloqueado: null };
        console.error("❌ [BLOQUEOS] error consultando bloqueados:", error.message);
        return { ok: false, motivo: "error_supabase", error: error.message, bloqueado: null };

    }

    return { ok: true, bloqueado: (data || [])[0] || null };

}

// ==========================================================================
// registrarIntento({ bloqueadoId, usuarioId, grupoId, grupoNombre,
// resultado, error }) — bitácora (bloqueo_intentos) + contadores en
// "bloqueados". Nunca desactiva el bloqueo por un intento fallido (regla
// explícita: "el bloqueo interno permanece activo" aunque la expulsión
// falle).
// ==========================================================================
async function registrarIntento({ bloqueadoId, usuarioId, grupoId, grupoNombre, resultado, error: errorExpulsion }) {

    if (!bloqueadoId || !usuarioId || !grupoId || !resultado) {
        return { ok: false, motivo: "faltan_parametros" };
    }

    const { error: errorInsert } = await supabase
        .from("bloqueo_intentos")
        .insert({
            bloqueado_id: bloqueadoId,
            usuario_id: usuarioId,
            grupo_id: grupoId,
            grupo_nombre: grupoNombre || null,
            resultado,
            error: errorExpulsion || null
        });

    if (errorInsert) {

        if (migracionPendiente(errorInsert)) return { ok: false, motivo: "migracion_pendiente" };
        console.error("❌ [BLOQUEOS] error registrando intento:", errorInsert.message);
        return { ok: false, motivo: "error_supabase", error: errorInsert.message };

    }

    // Lectura-then-update explícita (no RPC de incremento atómico en este
    // proyecto) — mismo criterio ya usado en otros contadores del sistema.
    // Una condición de carrera extrema entre dos expulsiones casi
    // simultáneas del MISMO bloqueado podría perder +1 en el contador; el
    // registro exacto de cada evento real, que es lo que importa para
    // auditoría, siempre queda en bloqueo_intentos sin excepción.
    const { data: actual, error: errorLectura } = await supabase
        .from("bloqueados")
        .select("intentos_ingreso, expulsiones")
        .eq("id", bloqueadoId)
        .maybeSingle();

    if (errorLectura || !actual) {
        return { ok: true, contadoresActualizados: false };
    }

    const { error: errorUpdate } = await supabase
        .from("bloqueados")
        .update({
            intentos_ingreso: (actual.intentos_ingreso || 0) + 1,
            expulsiones: (actual.expulsiones || 0) + (resultado === "expulsado" ? 1 : 0),
            ultimo_grupo_id: grupoId,
            ultimo_grupo_nombre: grupoNombre || null,
            ultimo_intento_en: new Date().toISOString(),
            actualizado_en: new Date().toISOString()
        })
        .eq("id", bloqueadoId);

    if (errorUpdate) {
        console.error("❌ [BLOQUEOS] error actualizando contadores:", errorUpdate.message);
        return { ok: true, contadoresActualizados: false };
    }

    return { ok: true, contadoresActualizados: true };

}

// ==========================================================================
// registrarIntentoExpulsion(...) — historial de la expulsión centralizada
// (procesarExpulsion.js, migración 040): un registro por intento real o
// simulado, vinculado a su tarea. Contadores: "expulsiones" solo con una
// expulsión VERIFICADA; "intentos_ingreso" solo cuando el origen fue un
// reingreso al grupo (su significado de siempre). Best-effort: nunca lanza.
// ==========================================================================
async function registrarIntentoExpulsion({ bloqueadoId, usuarioId, expulsionId, grupoId, grupoNombre, resultado, error: detalle, origen, modo, statusWhatsapp, sessionId }) {

    try {

        const { error: errorInsert } = await supabase
            .from("bloqueo_intentos")
            .insert({
                bloqueado_id: bloqueadoId,
                usuario_id: usuarioId,
                expulsion_id: expulsionId || null,
                grupo_id: grupoId,
                grupo_nombre: grupoNombre || null,
                resultado,
                error: detalle || null,
                origen: origen || null,
                modo: modo || null,
                status_whatsapp: statusWhatsapp || null,
                session_id: sessionId || null
            });

        if (errorInsert) {
            console.error("❌ [BLOQUEOS] no se pudo registrar el intento de expulsión:", errorInsert.code || errorInsert.message);
            return { ok: false, motivo: migracionPendiente(errorInsert) || errorInsert.code === "42703" ? "migracion_pendiente" : "error_supabase" };
        }

        const { data: actual } = await supabase
            .from("bloqueados")
            .select("intentos_ingreso, expulsiones")
            .eq("id", bloqueadoId)
            .maybeSingle();

        if (!actual) return { ok: true, contadoresActualizados: false };

        await supabase
            .from("bloqueados")
            .update({
                intentos_ingreso: (actual.intentos_ingreso || 0) + (origen === "reingreso" ? 1 : 0),
                expulsiones: (actual.expulsiones || 0) + (resultado === "expulsado" ? 1 : 0),
                ultimo_grupo_id: grupoId,
                ultimo_grupo_nombre: grupoNombre || null,
                ultimo_intento_en: new Date().toISOString(),
                actualizado_en: new Date().toISOString()
            })
            .eq("id", bloqueadoId);

        return { ok: true, contadoresActualizados: true };

    } catch (err) {

        console.error("❌ [BLOQUEOS] excepción registrando el intento de expulsión:", err?.message);
        return { ok: false, motivo: "error_interno" };

    }

}

// Historial de intentos de UN bloqueo (panel), del cliente dueño.
async function listarIntentos(usuarioId, bloqueadoId, { limite = 50 } = {}) {

    const { data, error } = await supabase
        .from("bloqueo_intentos")
        .select("*")
        .eq("usuario_id", usuarioId)
        .eq("bloqueado_id", bloqueadoId)
        .order("creado_en", { ascending: false })
        .limit(limite);

    if (error) return { ok: false, motivo: migracionPendiente(error) ? "migracion_pendiente" : "error_supabase", intentos: [] };

    return { ok: true, intentos: data || [] };

}

// Resultado del bloqueo NATIVO de WhatsApp (columnas de la 040). Sin la
// migración (42703) simplemente no se guarda.
async function registrarBloqueoNativo(bloqueadoId, usuarioId, { estado, error: detalle = null }) {

    try {

        const { error } = await supabase
            .from("bloqueados")
            .update({ bloqueo_nativo_estado: estado, bloqueo_nativo_error: detalle, bloqueo_nativo_en: new Date().toISOString() })
            .eq("id", bloqueadoId)
            .eq("usuario_id", usuarioId);

        if (error && error.code !== "42703") console.error("⚠️ [BLOQUEOS] no se pudo guardar el estado del bloqueo nativo:", error.code || error.message);

    } catch (err) {

        console.error("⚠️ [BLOQUEOS] excepción guardando el estado del bloqueo nativo:", err?.message);

    }

}

module.exports = {
    crearBloqueo,
    desbloquear,
    listarBloqueados,
    obtenerBloqueoDeContacto,
    buscarBloqueoActivo,
    registrarIntento,
    registrarIntentoExpulsion,
    listarIntentos,
    registrarBloqueoNativo
};
