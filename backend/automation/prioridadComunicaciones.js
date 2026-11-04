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
        .select("id, estado, config")
        .eq("usuario_id", evento.usuario_id)
        .eq("identidad_evento_real", evento.identidad_evento_real)
        .neq("estado", "cancelado")
        .order("creado_en", { ascending: false })
        .limit(1);
    // Sin la migración 024 no hay sorteos del panel: todo es del grupo.
    if (error) return error.code === "42P01" ? { ok: true, sorteo: null } : { ok: false, error };
    return { ok: true, sorteo: data?.[0] || null };
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
const claveCierreSorteo = (sorteoId, grupoId) => `sorteo:${sorteoId}:grupo:${grupoId}:aviso_cierre`;
const claveCierreGrupo = (eventSessionId) => `${eventSessionId}:CLOSE_MESSAGE`;

async function avisoCierreYaEnviado({ eventoId, grupoId, sorteoId = null }) {
    const claves = [];
    if (sorteoId) claves.push(claveCierreSorteo(sorteoId, grupoId));
    if (eventoId) {
        const { data: ciclos, error } = await supabase.from("event_sessions").select("id").eq("evento_id", eventoId);
        if (error) throw error;
        for (const c of ciclos || []) claves.push(claveCierreGrupo(c.id));
    }
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
    claveCierreGrupo
};
