// ==========================================================================
// repo/tablaEvento.js — SOLO LECTURA de la tabla de reservas REAL del
// evento (evento.tabla: "reservas_dos_cifras" / "5k_15k_reservas_2_cifras",
// ver bot/funciones/eventos/configEvento.js), para INITIAL_TABLE (Fase 5).
//
// Mismo patrón exacto que repo/reservasActividad.js: Automation Engine
// consulta DIRECTAMENTE la tabla EXISTENTE vía Supabase, sin pasar por
// bot/ — el Automation Engine nunca requiere nada de bot/ (arquitectura
// confirmada por tests/automation/eventSessions.test.js "extra"/"extra2" y
// tests/scheduler/schedulerAutomation.test.js #19). Es la misma consulta
// que ya hace bot/funciones/consultas/consultarDisponibilidad.js (mismo
// select, mismo criterio libre/ocupado) — duplicada aquí a propósito,
// nunca importada desde bot/, para no cruzar esa frontera.
// ==========================================================================

const supabase = require("../../lib/supabase");

// obtenerNumeros(nombreTabla, usuarioId) -> { numerosDisponibles, numerosOcupados }
//
// nombreTabla es SIEMPRE evento.tabla (el nombre real de la tabla de
// reservas de ESTE evento) — nunca inventado, nunca hardcodeado aquí.
//
// SEGURIDAD (2026-10-21): la tabla física la comparten todos los clientes
// (100 filas por usuario_id). Antes se leía entera y la imagen de un
// cliente mezclaba las cuadrículas de todos. usuarioId (el dueño del
// evento, evento.usuario_id) es OBLIGATORIO: sin él no se devuelve nada.
async function obtenerNumeros(nombreTabla, usuarioId) {

    if (!nombreTabla || !usuarioId) {
        return { numerosDisponibles: [], numerosOcupados: [] };
    }

    const { data, error } = await supabase
        .from(nombreTabla)
        .select("numero, estado")
        .eq("usuario_id", usuarioId)
        .order("numero", { ascending: true });

    if (error) throw error;

    const filas = data || [];

    const numerosDisponibles = filas
        .filter(r => r.estado === "libre")
        .map(r => r.numero);

    const numerosOcupados = filas
        .filter(r => r.estado !== "libre")
        .map(r => r.numero);

    return { numerosDisponibles, numerosOcupados };

}

module.exports = { obtenerNumeros };
