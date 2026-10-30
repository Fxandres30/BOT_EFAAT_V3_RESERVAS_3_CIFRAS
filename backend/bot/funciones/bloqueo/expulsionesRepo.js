// ==========================================================================
// expulsionesRepo.js — tareas persistentes de expulsión (bloqueo_expulsiones,
// migración 040): una por (bloqueo, grupo autorizado del cliente).
//
// Concurrencia: tomarTarea() es un UPDATE condicionado (compare-and-set sobre
// estado + intentos, y lease libre o vencido). En Postgres, dos instancias que
// intentan el mismo UPDATE a la vez se serializan por el bloqueo de la fila y
// la segunda reevalúa el WHERE: solo una obtiene la fila. Si la instancia que
// la tenía muere, el lease vence y otra la retoma (recuperación tras
// reinicio). cerrarTarea() solo escribe si el lease sigue siendo de quien
// cierra: un proceso que perdió su lease nunca pisa el resultado de otro.
//
// Este archivo no habla con WhatsApp: ver procesarExpulsion.js.
// ==========================================================================

const supabase = require("../../../lib/supabase");

const TABLA = "bloqueo_expulsiones";

// Verificados: la persona ya no está en el grupo.
const EXITO = ["expulsado", "ya_no_estaba"];

// Sin reintento automático. Se pueden reintentar a mano los de
// REINTENTABLES_MANUAL.
const FINALES = ["expulsado", "ya_no_estaba", "identidad_ambigua", "no_expulsable", "cancelado", "simulado"];

// El worker los retoma solo cuando llega su proximo_intento_en.
const REINTENTABLES_AUTO = ["pendiente", "sin_verificar", "sin_permisos", "sesion_desconectada", "error_whatsapp"];

// «Reintentar» del panel. Nunca toca expulsado/ya_no_estaba (no se duplica
// una expulsión verificada) ni en_curso (lo tiene otra instancia).
const REINTENTABLES_MANUAL = [...REINTENTABLES_AUTO, "identidad_ambigua", "no_expulsable", "simulado"];

// La vigilancia los devuelve a "pendiente" si la persona vuelve a aparecer
// en el grupo (cancelado solo llega aquí con el bloqueo activo: grupo
// desautorizado y vuelto a autorizar). Nunca simulado: en simulación la
// persona sigue dentro y se reabriría en cada revisión.
const REABRIBLES = [...EXITO, "cancelado"];

// Un desbloqueo cancela lo que aún no terminó (en_curso lo cancela el propio
// procesador al releer el bloqueo).
const CANCELABLES = [...REINTENTABLES_MANUAL];

function migracionPendiente(error) {
    return !!error && (error.code === "42P01" || error.code === "42703");
}

function iso(fecha) {
    return (fecha instanceof Date ? fecha : new Date(fecha)).toISOString();
}

function fallo(error) {
    return migracionPendiente(error)
        ? { ok: false, motivo: "migracion_pendiente", error: error.message }
        : { ok: false, motivo: "error_supabase", error: error?.message || String(error) };
}

// Grupos autorizados ACTIVOS del cliente, con el nombre cacheado si existe.
async function gruposAutorizados(usuarioId) {

    const { data, error } = await supabase
        .from("grupos_autorizados")
        .select("grupo_id")
        .eq("usuario_id", usuarioId)
        .eq("activo", true);

    if (error) return { ok: false, error: error.message };

    const ids = [...new Set((data || []).map(f => f.grupo_id).filter(Boolean))];
    const nombres = new Map();

    if (ids.length) {
        try {
            const { data: grupos } = await supabase.from("grupos").select("jid, nombre").in("jid", ids);
            for (const g of grupos || []) nombres.set(g.jid, g.nombre || null);
        } catch { /* solo informativo */ }
    }

    return { ok: true, grupos: ids.map(id => ({ grupo_id: id, grupo_nombre: nombres.get(id) || null })) };

}

// Crea las tareas que falten para un bloqueo (una por grupo autorizado). Un
// segundo clic, o dos peticiones simultáneas, no duplican nada: el índice
// único (bloqueado_id, grupo_id) + ignoreDuplicates. Con reiniciar=true (el
// contacto estaba desbloqueado y se vuelve a bloquear) las tareas que ya
// existían vuelven a "pendiente".
async function programarExpulsiones({ usuarioId, bloqueado, origen = "bloqueo", reiniciar = false, ahora = new Date() }) {

    if (!usuarioId || !bloqueado?.id) return { ok: false, motivo: "faltan_parametros" };
    if (bloqueado.usuario_id && bloqueado.usuario_id !== usuarioId) return { ok: false, motivo: "bloqueo_ajeno" };

    const autorizados = await gruposAutorizados(usuarioId);
    if (!autorizados.ok) return { ok: false, motivo: "error_supabase", error: autorizados.error };

    const marca = iso(ahora);

    if (autorizados.grupos.length) {

        const { error } = await supabase
            .from(TABLA)
            .upsert(autorizados.grupos.map(g => ({
                bloqueado_id: bloqueado.id,
                usuario_id: usuarioId,
                grupo_id: g.grupo_id,
                grupo_nombre: g.grupo_nombre,
                origen,
                estado: "pendiente",
                intentos: 0,
                proximo_intento_en: marca,
                solicitada_en: marca,
                actualizado_en: marca
            })), { onConflict: "bloqueado_id,grupo_id", ignoreDuplicates: true });

        if (error) return fallo(error);

    }

    if (reiniciar) {

        const { error } = await supabase
            .from(TABLA)
            .update({ estado: "pendiente", origen, intentos: 0, proximo_intento_en: marca, ultimo_error: null, ultimo_status: null, verificada_en: null, solicitada_en: marca, actualizado_en: marca })
            .eq("bloqueado_id", bloqueado.id)
            .eq("usuario_id", usuarioId)
            .neq("estado", "en_curso");

        if (error) return fallo(error);

    }

    const tareas = await listarDeBloqueo(usuarioId, bloqueado.id);
    if (!tareas.ok) return tareas;

    return {
        ok: true,
        grupos: autorizados.grupos.length,
        motivo: autorizados.grupos.length ? null : "sin_grupos_autorizados",
        tareas: tareas.tareas
    };

}

// Vigilancia: crea las tareas que falten para TODOS los bloqueos activos del
// cliente (bloqueos anteriores a la 040, grupos autorizados después del
// bloqueo). Una lectura de grupos y un upsert; lo existente no se toca.
async function asegurarTareasDeActivos(usuarioId, bloqueados, { ahora = new Date() } = {}) {

    const activos = (bloqueados || []).filter(b => b?.activo && b.id && (!b.usuario_id || b.usuario_id === usuarioId));

    if (!usuarioId || activos.length === 0) return { ok: true, grupos: [] };

    const autorizados = await gruposAutorizados(usuarioId);
    if (!autorizados.ok) return { ok: false, motivo: "error_supabase", error: autorizados.error, grupos: [] };

    if (autorizados.grupos.length === 0) return { ok: true, grupos: [] };

    const marca = iso(ahora);
    const filas = [];

    for (const b of activos) for (const g of autorizados.grupos) {
        filas.push({
            bloqueado_id: b.id, usuario_id: usuarioId, grupo_id: g.grupo_id, grupo_nombre: g.grupo_nombre,
            origen: "bloqueo", estado: "pendiente", intentos: 0, proximo_intento_en: marca, solicitada_en: marca, actualizado_en: marca
        });
    }

    const { error } = await supabase.from(TABLA).upsert(filas, { onConflict: "bloqueado_id,grupo_id", ignoreDuplicates: true });

    if (error) return { ...fallo(error), grupos: autorizados.grupos };

    return { ok: true, grupos: autorizados.grupos };

}

// Vigilancia: la persona volvió a aparecer en un grupo cuya tarea estaba
// resuelta. Compare-and-set sobre el estado leído: si otra instancia ya la
// movió, no se pisa.
async function reabrirPorPresencia(tarea, { ahora = new Date() } = {}) {

    if (!REABRIBLES.includes(tarea?.estado)) return { ok: true, reabierta: false };

    const marca = iso(ahora);

    const { data, error } = await supabase
        .from(TABLA)
        .update({ estado: "pendiente", origen: "reingreso", intentos: 0, proximo_intento_en: marca, ultimo_error: null, ultimo_status: null, verificada_en: null, solicitada_en: marca, actualizado_en: marca })
        .eq("id", tarea.id)
        .eq("usuario_id", tarea.usuario_id)
        .eq("estado", tarea.estado)
        .select();

    if (error) return fallo(error);

    return { ok: true, reabierta: (data || []).length === 1 };

}

// Reingreso del bloqueado a un grupo: la tarea de ese grupo vuelve a
// pendiente (aunque antes estuviera expulsado: ahora está dentro otra vez).
async function prepararReingreso({ usuarioId, bloqueado, grupoId, grupoNombre = null, ahora = new Date() }) {

    const marca = iso(ahora);

    const { error: errorAlta } = await supabase
        .from(TABLA)
        .upsert([{
            bloqueado_id: bloqueado.id, usuario_id: usuarioId, grupo_id: grupoId, grupo_nombre: grupoNombre,
            origen: "reingreso", estado: "pendiente", intentos: 0, proximo_intento_en: marca, solicitada_en: marca, actualizado_en: marca
        }], { onConflict: "bloqueado_id,grupo_id", ignoreDuplicates: true });

    if (errorAlta) return fallo(errorAlta);

    const { data, error } = await supabase
        .from(TABLA)
        .update({ estado: "pendiente", origen: "reingreso", intentos: 0, proximo_intento_en: marca, ultimo_error: null, ultimo_status: null, verificada_en: null, solicitada_en: marca, actualizado_en: marca, ...(grupoNombre ? { grupo_nombre: grupoNombre } : {}) })
        .eq("bloqueado_id", bloqueado.id)
        .eq("usuario_id", usuarioId)
        .eq("grupo_id", grupoId)
        .neq("estado", "en_curso")
        .select();

    if (error) return fallo(error);

    return { ok: true, tarea: (data || [])[0] || null };

}

async function listarDeBloqueo(usuarioId, bloqueadoId) {

    const { data, error } = await supabase
        .from(TABLA)
        .select("*")
        .eq("usuario_id", usuarioId)
        .eq("bloqueado_id", bloqueadoId)
        .order("grupo_nombre", { ascending: true });

    if (error) return { ...fallo(error), tareas: [] };

    return { ok: true, tareas: data || [] };

}

async function listarDeCliente(usuarioId) {

    const { data, error } = await supabase
        .from(TABLA)
        .select("*")
        .eq("usuario_id", usuarioId);

    if (error) return { ...fallo(error), tareas: [] };

    return { ok: true, tareas: data || [] };

}

// Tareas que esta pasada puede intentar tomar: reintentables cuyo turno llegó,
// en_curso con lease vencido (instancia caída) y, solo en modo real, las que
// quedaron "simulado" (se simularon antes de activar la expulsión real).
async function listarProcesables(usuarioId, { modo, ahora = new Date(), lote = 10, bloqueadoId = null } = {}) {

    const marca = iso(ahora);

    const consulta = () => {
        let q = supabase.from(TABLA).select("*").eq("usuario_id", usuarioId);
        if (bloqueadoId) q = q.eq("bloqueado_id", bloqueadoId);
        return q;
    };

    const lecturas = [
        consulta().in("estado", REINTENTABLES_AUTO).lte("proximo_intento_en", marca).order("proximo_intento_en", { ascending: true }).limit(lote),
        consulta().eq("estado", "en_curso").lt("lease_hasta", marca).limit(lote)
    ];

    if (modo === "real") lecturas.push(consulta().eq("estado", "simulado").limit(lote));

    const resultados = await Promise.all(lecturas);

    const error = resultados.find(r => r.error)?.error;
    if (error) return { ...fallo(error), tareas: [] };

    const vistas = new Map();
    for (const r of resultados) for (const t of r.data || []) if (!vistas.has(t.id)) vistas.set(t.id, t);

    return { ok: true, tareas: [...vistas.values()].slice(0, lote) };

}

// Compare-and-set: la toma quien encuentre la fila con el MISMO estado e
// intentos que leyó y el lease libre o vencido. Devuelve la fila tomada o null.
async function tomarTarea(tarea, { instancia, leaseSegundos = 120, ahora = new Date() }) {

    const marca = iso(ahora);
    const hasta = iso(new Date(ahora.getTime() + leaseSegundos * 1000));

    const { data, error } = await supabase
        .from(TABLA)
        .update({
            estado: "en_curso",
            lease_hasta: hasta,
            lease_por: instancia,
            intentos: (tarea.intentos || 0) + 1,
            ultimo_intento_en: marca,
            actualizado_en: marca
        })
        .eq("id", tarea.id)
        .eq("usuario_id", tarea.usuario_id)
        .eq("estado", tarea.estado)
        .eq("intentos", tarea.intentos || 0)
        .or(`lease_hasta.is.null,lease_hasta.lt.${marca}`)
        .select();

    if (error) return { ok: false, ...fallo(error), tarea: null };

    return { ok: true, tarea: (data || [])[0] || null };

}

// Marca intermedia antes de enviar la expulsión: si el proceso muere justo
// después, quien retome la tarea sabe que la solicitud pudo llegar.
async function anotarEnvio(tarea, { instancia, participanteJid, criterio, sessionId, modo }) {

    const { data, error } = await supabase
        .from(TABLA)
        .update({ ultimo_status: "enviando", participante_jid: participanteJid, criterio_identidad: criterio, session_id: sessionId, modo, actualizado_en: iso(new Date()) })
        .eq("id", tarea.id)
        .eq("lease_por", instancia)
        .eq("estado", "en_curso")
        .select();

    if (error) return { ok: false, ...fallo(error) };

    return { ok: (data || []).length === 1, motivo: (data || []).length === 1 ? null : "lease_perdido" };

}

// Cierra el intento con su resultado y suelta el lease. Solo si el lease
// sigue siendo de esta instancia.
async function cerrarTarea(tarea, campos, { instancia, ahora = new Date() }) {

    const { data, error } = await supabase
        .from(TABLA)
        .update({ ...campos, lease_hasta: null, lease_por: null, actualizado_en: iso(ahora) })
        .eq("id", tarea.id)
        .eq("lease_por", instancia)
        .eq("estado", "en_curso")
        .select();

    if (error) return { ok: false, ...fallo(error) };

    return { ok: (data || []).length === 1, motivo: (data || []).length === 1 ? null : "lease_perdido", tarea: (data || [])[0] || null };

}

// Sin WhatsApp conectado: las tareas listadas quedan "sesion_desconectada"
// sin tomarlas (no gastan intentos). Condicionado a que nadie las haya
// tocado desde la lectura.
async function marcarSinSesion(tareas, error, { ahora = new Date() } = {}) {

    const marca = iso(ahora);
    let marcadas = 0;

    for (const t of tareas) {

        if (!["pendiente", "sesion_desconectada", "sin_permisos", "error_whatsapp", "sin_verificar", "simulado"].includes(t.estado)) continue;

        const { data } = await supabase
            .from(TABLA)
            .update({ estado: "sesion_desconectada", ultimo_error: error, proximo_intento_en: marca, actualizado_en: marca })
            .eq("id", t.id)
            .eq("estado", t.estado)
            .eq("intentos", t.intentos || 0)
            .select();

        marcadas += (data || []).length;

    }

    return { ok: true, marcadas };

}

// Al (re)conectar la sesión del cliente: lo que esperaba sesión se retoma ya.
async function reactivarSinSesion(usuarioId, { ahora = new Date() } = {}) {

    const { data, error } = await supabase
        .from(TABLA)
        .update({ proximo_intento_en: iso(ahora), actualizado_en: iso(ahora) })
        .eq("usuario_id", usuarioId)
        .eq("estado", "sesion_desconectada")
        .select();

    if (error) return fallo(error);

    return { ok: true, reactivadas: (data || []).length };

}

// «Reintentar» del panel: solo lo no resuelto vuelve a pendiente.
async function reintentarDeBloqueo(usuarioId, bloqueadoId, { ahora = new Date() } = {}) {

    const marca = iso(ahora);

    const { data, error } = await supabase
        .from(TABLA)
        .update({ estado: "pendiente", origen: "reintento", intentos: 0, proximo_intento_en: marca, ultimo_error: null, actualizado_en: marca })
        .eq("usuario_id", usuarioId)
        .eq("bloqueado_id", bloqueadoId)
        .in("estado", REINTENTABLES_MANUAL)
        .select();

    if (error) return fallo(error);

    return { ok: true, reprogramadas: (data || []).length };

}

async function cancelarDeBloqueo(usuarioId, bloqueadoId, motivo = "el contacto fue desbloqueado", { ahora = new Date() } = {}) {

    const { data, error } = await supabase
        .from(TABLA)
        .update({ estado: "cancelado", ultimo_error: motivo, proximo_intento_en: null, actualizado_en: iso(ahora) })
        .eq("usuario_id", usuarioId)
        .eq("bloqueado_id", bloqueadoId)
        .in("estado", CANCELABLES)
        .select();

    if (error) return fallo(error);

    return { ok: true, canceladas: (data || []).length };

}

async function leerBloqueo(bloqueadoId, usuarioId) {

    const { data, error } = await supabase
        .from("bloqueados")
        .select("*")
        .eq("id", bloqueadoId)
        .eq("usuario_id", usuarioId)
        .maybeSingle();

    if (error) return { ok: false, error: error.message, bloqueado: null };

    return { ok: true, bloqueado: data || null };

}

// --------------------------------------------------------------------------
// Estado general de un bloqueo a partir de sus tareas (no se guarda: así no
// puede desincronizarse de ellas).
//
//   desbloqueado | solo_registrado | expulsion_pendiente | expulsado_de_todos
//   | simulado | parcial | sesion_desconectada | error_permisos
//   | error_whatsapp | requiere_atencion
// --------------------------------------------------------------------------
function resumirTareas(tareas = []) {

    const porEstado = {};
    for (const t of tareas) porEstado[t.estado] = (porEstado[t.estado] || 0) + 1;

    const contar = (lista) => lista.reduce((n, e) => n + (porEstado[e] || 0), 0);

    return {
        total: tareas.length,
        porEstado,
        expulsados: porEstado.expulsado || 0,
        yaNoEstaban: porEstado.ya_no_estaba || 0,
        resueltos: contar(EXITO),
        enProceso: contar(["pendiente", "en_curso"]),
        simulados: porEstado.simulado || 0,
        cancelados: porEstado.cancelado || 0,
        conProblema: tareas.length - contar([...EXITO, "pendiente", "en_curso", "simulado", "cancelado"])
    };

}

const PROBLEMA_A_ESTADO = {
    sesion_desconectada: "sesion_desconectada",
    sin_permisos: "error_permisos",
    error_whatsapp: "error_whatsapp",
    sin_verificar: "error_whatsapp"
};

function estadoGeneral(bloqueado, tareas = [], { migracionPendiente: sinMigracion = false } = {}) {

    if (!bloqueado?.activo) return "desbloqueado";
    if (sinMigracion) return "solo_registrado";

    const vigentes = tareas.filter(t => t.estado !== "cancelado");
    if (vigentes.length === 0) return "solo_registrado";

    const r = resumirTareas(vigentes);

    if (r.enProceso > 0) return "expulsion_pendiente";
    if (r.resueltos === r.total) return "expulsado_de_todos";
    if (r.conProblema === 0) return "simulado";
    if (r.resueltos > 0) return "parcial";

    const problemas = new Set(vigentes
        .filter(t => !EXITO.includes(t.estado) && t.estado !== "simulado")
        .map(t => PROBLEMA_A_ESTADO[t.estado] || "requiere_atencion"));

    return problemas.size === 1 ? [...problemas][0] : "requiere_atencion";

}

module.exports = {
    TABLA,
    EXITO,
    FINALES,
    REINTENTABLES_AUTO,
    REINTENTABLES_MANUAL,
    REABRIBLES,
    migracionPendiente,
    gruposAutorizados,
    programarExpulsiones,
    asegurarTareasDeActivos,
    reabrirPorPresencia,
    prepararReingreso,
    listarDeBloqueo,
    listarDeCliente,
    listarProcesables,
    tomarTarea,
    anotarEnvio,
    cerrarTarea,
    marcarSinSesion,
    reactivarSinSesion,
    reintentarDeBloqueo,
    cancelarDeBloqueo,
    leerBloqueo,
    resumirTareas,
    estadoGeneral
};
