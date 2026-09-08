// ==========================================================================
// repo/eventSessions.js — SOLO persistencia de event_sessions.
//
// Sin reglas de negocio aquí (eso vive en eventRules.js) y sin
// orquestación (eso vive en engine.js). Cada función es una operación de
// lectura/escritura directa contra Supabase, nada más.
// ==========================================================================

const supabase = require("../../lib/supabase");

// Reutilizado, no duplicado: el chequeo genérico de "¿es un 23505?" ya vive
// en executionGuard.js. Este archivo NO se modifica — solo se importa su
// función exportada (auditoría Fase 2B, hallazgo E).
const { esViolacionUnicidad } = require("../executionGuard");

const TABLA = "event_sessions";

// Nombre real que Postgres asigna automáticamente a un `unique (a, b)`
// declarado SIN nombre explícito dentro de un CREATE TABLE: sigue la
// convención documentada "<tabla>_<columna1>_<columna2>_key". Es exactamente
// como quedó escrito en 006_automation_engine.sql ("unique (grupo_id,
// identidad_ciclo)", sin `constraint <nombre>`), así que este es el nombre
// real que Postgres le pondría — no una migración nueva ni un cambio al SQL.
//
// LIMITACIÓN DOCUMENTADA (pedida explícitamente en esta corrección): esto
// distingue el constraint por el TEXTO del error que devuelve Postgres
// (mensaje/`details`), no por una consulta estructural al catálogo de
// Postgres — no hay forma más confiable de hacerlo sin agregar una consulta
// extra a information_schema, que sería más invasivo que el problema que
// resuelve. Si el texto no calza con lo esperado, NO se asume igualmente
// "ciclo_duplicado": se conserva el error original tal cual (ver
// esViolacionUnicidadDeCiclo más abajo) — la solución más segura ante la
// duda es fallar visible, no enmascarar un error distinto bajo esta misma
// etiqueta.
const NOMBRE_CONSTRAINT_CICLO = "event_sessions_grupo_id_identidad_ciclo_key";

// Error específico y tipado para el único caso que le interesa a
// engine.js: la colisión de la UNIQUE(grupo_id, identidad_ciclo) real de
// Postgres. `esCicloDuplicado` es la forma de detectarlo (más robusta que
// `instanceof` frente a recargas de módulo vía require.cache en los tests).
class CicloDuplicadoError extends Error {

    constructor(grupoId, identidadCiclo) {

        super(`event_sessions: ya existe un ciclo para (grupo_id=${grupoId}, identidad_ciclo=${identidadCiclo})`);

        this.name = "CicloDuplicadoError";
        this.esCicloDuplicado = true;
        this.grupoId = grupoId;
        this.identidadCiclo = identidadCiclo;

    }

}

// Distingue la violación de ESTA unique específica de cualquier otro 23505
// que en teoría pudiera ocurrir sobre event_sessions (ver limitación
// documentada arriba). Solo se llama cuando ya se confirmó
// esViolacionUnicidad(error) === true.
function esViolacionUnicidadDeCiclo(error) {

    const texto = [error?.message, error?.details].filter(Boolean).join(" ");

    return texto.includes(NOMBRE_CONSTRAINT_CICLO) ||
        (texto.includes("grupo_id") && texto.includes("identidad_ciclo"));

}

async function buscarPorIdentidadCiclo(grupoId, identidadCiclo) {

    const { data, error } = await supabase
        .from(TABLA)
        .select("*")
        .eq("grupo_id", grupoId)
        .eq("identidad_ciclo", identidadCiclo)
        .maybeSingle();

    if (error) throw error;

    return data;

}

// datosEventoSnapshot es OBLIGATORIO (columna NOT NULL en la migración,
// ver 006_automation_engine.sql) — nunca se inserta un event_session sin él.
async function crear({
    eventoId = null,
    identidadCiclo,
    grupoId,
    sessionId = null,
    usuarioId,
    automationConfigId = null,
    datosEventoSnapshot
}) {

    if (!identidadCiclo) throw new Error("eventSessions.crear: identidadCiclo es obligatoria");
    if (!grupoId) throw new Error("eventSessions.crear: grupoId es obligatorio");
    if (!usuarioId) throw new Error("eventSessions.crear: usuarioId es obligatorio");
    if (!datosEventoSnapshot) throw new Error("eventSessions.crear: datosEventoSnapshot es obligatorio");

    const { data, error } = await supabase
        .from(TABLA)
        .insert({

            evento_id: eventoId,
            identidad_ciclo: identidadCiclo,
            grupo_id: grupoId,
            session_id: sessionId,
            usuario_id: usuarioId,
            automation_config_id: automationConfigId,
            estado: "pendiente",
            datos_evento_snapshot: datosEventoSnapshot

        })
        .select()
        .single();

    if (error) {

        // 23505 sobre la UNIQUE(grupo_id, identidad_ciclo) real: dos
        // llamadas concurrentes a crear() para el MISMO ciclo — la
        // protección primaria (Postgres) ya hizo su trabajo, esto solo
        // traduce ese resultado en algo que engine.js pueda manejar sin
        // que sea una excepción genérica. Cualquier otro 23505 (no
        // reconocible como esta constraint específica) u otro error de
        // Supabase se relanza tal cual, sin ocultarlo ni disfrazarlo.
        if (esViolacionUnicidad(error) && esViolacionUnicidadDeCiclo(error)) {

            throw new CicloDuplicadoError(grupoId, identidadCiclo);

        }

        throw error;

    }

    return data;

}

// Última sesión NO finalizada (pendiente/abierto/cerrando) de un grupo, si
// existe. "Activa" en el sentido de "sigue en curso", no en el sentido de
// eventos_bot.activo (son conceptos distintos, ver Master Spec §6).
async function obtenerActivaPorGrupo(grupoId) {

    const { data, error } = await supabase
        .from(TABLA)
        .select("*")
        .eq("grupo_id", grupoId)
        .in("estado", ["pendiente", "abierto", "cerrando"])
        .order("creado_en", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) throw error;

    return data;

}

async function marcarAbierto(id) {

    return actualizar(id, {
        estado: "abierto",
        abierto_en: new Date().toISOString()
    });

}

async function marcarCerrando(id) {

    return actualizar(id, { estado: "cerrando" });

}

async function marcarCerrado(id) {

    return actualizar(id, {
        estado: "cerrado",
        cerrado_en: new Date().toISOString()
    });

}

async function marcarExpirado(id) {

    return actualizar(id, { estado: "expirado" });

}

async function actualizar(id, cambios) {

    const { data, error } = await supabase
        .from(TABLA)
        .update({
            ...cambios,
            actualizado_en: new Date().toISOString()
        })
        .eq("id", id)
        .select()
        .single();

    if (error) throw error;

    return data;

}

async function obtenerPendientes() {

    const { data, error } = await supabase
        .from(TABLA)
        .select("*")
        .eq("estado", "pendiente")
        .order("creado_en", { ascending: true });

    if (error) throw error;

    return data || [];

}

async function obtenerAbiertas() {

    const { data, error } = await supabase
        .from(TABLA)
        .select("*")
        .in("estado", ["abierto", "cerrando"])
        .order("creado_en", { ascending: true });

    if (error) throw error;

    return data || [];

}

// Igual que obtenerAbiertas(), pero acotado a una sesion de WhatsApp
// concreta (session_id) -- es lo que necesita el Scheduler (Fase 4B): cada
// instancia de backend solo debe procesar los event_sessions de las
// sesiones que tiene realmente conectadas (sock), nunca las de otra
// instancia/VPS.
async function obtenerAbiertasPorSesion(sessionId) {

    const { data, error } = await supabase
        .from(TABLA)
        .select("*")
        .eq("session_id", sessionId)
        .in("estado", ["abierto", "cerrando"])
        .order("creado_en", { ascending: true });

    if (error) throw error;

    return data || [];

}

module.exports = {
    buscarPorIdentidadCiclo,
    crear,
    obtenerActivaPorGrupo,
    marcarAbierto,
    marcarCerrando,
    marcarCerrado,
    marcarExpirado,
    actualizar,
    obtenerPendientes,
    obtenerAbiertas,
    obtenerAbiertasPorSesion,
    CicloDuplicadoError
};
