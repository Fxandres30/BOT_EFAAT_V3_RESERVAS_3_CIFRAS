// ==========================================================================
// automation/prioridadComunicaciones.js — QUIÉN envía cada comunicación de
// un evento publicado: la configuración ESPECÍFICA del sorteo o la GENERAL
// del grupo (automation_configs). Reglas del 04/11:
//
//   recordatorios    los del sorteo (config.recordatorios con al menos uno)
//                    tienen prioridad; sin ellos, los generales del grupo.
//   cierre           el aviso del sorteo (config.mensajes.aviso_cierre con
//                    texto) tiene prioridad; sin él, el CLOSE_MESSAGE del
//                    grupo. Nunca los dos para el mismo evento y grupo.
//   actualizaciones  el sorteo no tiene configuración propia: siempre las
//                    generales del grupo (una por movimiento y ciclo).
//
// Un evento detectado en WhatsApp no tiene sorteo del panel: todo es del
// grupo, como siempre.
//
// Los DOS emisores consultan este módulo y nada más:
//   - automation/scheduler.js        (generales del grupo)
//   - sorteos/publicador.js          (específicas del sorteo)
// La configuración de mensajes de un sorteo en curso no se puede cambiar
// (sorteosActivos: «mensajes» no editable), así que la decisión es la misma
// durante todo el evento. Además, antes de enviar un cierre cada emisor
// comprueba que el otro no lo envió ya (avisoCierreYaEnviado).
// ==========================================================================

const supabase = require("../lib/supabase");

const SORTEO = "sorteo";
const GRUPO = "grupo";

// Función pura: config del sorteo del panel (o null) -> fuente por tipo.
function fuentesDeComunicacion(configSorteo) {
    if (!configSorteo) return { recordatorios: GRUPO, cierre: GRUPO, actualizaciones: GRUPO };
    const recordatorios = Array.isArray(configSorteo.recordatorios) && configSorteo.recordatorios.length > 0;
    const cierre = Boolean(String(configSorteo.mensajes?.aviso_cierre || "").trim());
    return {
        recordatorios: recordatorios ? SORTEO : GRUPO,
        cierre: cierre ? SORTEO : GRUPO,
        actualizaciones: GRUPO
    };
}

// Sorteo del panel al que pertenece el evento (misma identidad y dueño).
// { ok: true, sorteo: {id, config} | null } — ok:false si no se pudo leer:
// el llamador NO envía nada en ese ciclo (falla cerrado, se reintenta).
async function sorteoDelEvento(evento) {
    if (!evento?.usuario_id || !evento?.identidad_evento_real) return { ok: true, sorteo: null };
    const { data, error } = await supabase.from("sorteos_programados")
        .select("id, estado, config, identidad_evento_real")
        .eq("usuario_id", evento.usuario_id)
        .eq("identidad_evento_real", evento.identidad_evento_real)
        .neq("estado", "cancelado")
        .order("creado_en", { ascending: false })
        .limit(10);
    // Sin la migración 024 no hay sorteos del panel: todo es del grupo.
    if (error) return error.code === "42P01" ? { ok: true, sorteo: null } : { ok: false, error };
    // Criterio único (F4-F.1): la más reciente, salvo una adoptante pura (sus
    // avisos son los de la programación propietaria de la publicación).
    const { elegirProgramacion } = require("../sorteos/publicacionCompartida");
    return { ok: true, sorteo: await elegirProgramacion(supabase, evento.usuario_id, data || []) };
}

// Fuentes para un evento concreto. { ok, fuentes, sorteo }
async function fuentesDelEvento(evento) {
    const r = await sorteoDelEvento(evento);
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, sorteo: r.sorteo, fuentes: fuentesDeComunicacion(r.sorteo?.config || null) };
}

// Claves del ExecutionGuard de los DOS avisos de cierre posibles de un evento
// en un grupo. Si cualquiera existe (en cualquier estado: enviado, en curso o
// fallido), el cierre de ese evento y grupo ya se gestionó: no se envía otro.
//
// VIGENCIA (F3-D, 06/11/2026): un sorteo reabierto tiene un ciclo NUEVO, y su
// siguiente cierre es otro cierre legítimo con su propio aviso. Por eso solo
// cuenta la vigencia ACTUAL: el ciclo más reciente del evento y la clave del
// aviso propio de esa vigencia. Un evento con un solo ciclo (nunca reabierto)
// usa exactamente las claves de siempre: ningún aviso ya enviado se repite.
const claveCierreSorteo = (sorteoId, grupoId, sufijo = "aviso_cierre") => `sorteo:${sorteoId}:grupo:${grupoId}:${sufijo}`;
const claveCierreGrupo = (eventSessionId) => `${eventSessionId}:CLOSE_MESSAGE`;

// Ciclos del evento, del más antiguo al más reciente.
async function ciclosDelEvento(eventoId) {
    if (!eventoId) return [];
    const { data, error } = await supabase.from("event_sessions").select("id, creado_en").eq("evento_id", eventoId).order("creado_en", { ascending: true });
    if (error) throw error;
    return data || [];
}

// Sufijo de la clave del aviso propio del sorteo en la vigencia actual: el de
// siempre en el primer ciclo; el id del ciclo de reapertura después.
function sufijoAvisoCierre(ciclos) {
    return (ciclos || []).length > 1 ? `aviso_cierre:${ciclos[ciclos.length - 1].id}` : "aviso_cierre";
}

async function avisoCierreYaEnviado({ eventoId, grupoId, sorteoId = null }) {
    const claves = [];
    const ciclos = await ciclosDelEvento(eventoId);
    if (sorteoId) claves.push(claveCierreSorteo(sorteoId, grupoId, sufijoAvisoCierre(ciclos)));
    if (ciclos.length) claves.push(claveCierreGrupo(ciclos[ciclos.length - 1].id));
    if (!claves.length) return false;
    const { data, error } = await supabase.from("automation_actions").select("clave_idempotencia").in("clave_idempotencia", claves);
    if (error) throw error;
    return (data || []).length > 0;
}

module.exports = {
    SORTEO,
    GRUPO,
    fuentesDeComunicacion,
    sorteoDelEvento,
    fuentesDelEvento,
    avisoCierreYaEnviado,
    claveCierreSorteo,
    claveCierreGrupo,
    ciclosDelEvento,
    sufijoAvisoCierre
};
