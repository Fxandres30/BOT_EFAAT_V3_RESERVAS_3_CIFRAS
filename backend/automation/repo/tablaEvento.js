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

// obtenerNumeros(nombreTabla) -> { numerosDisponibles, numerosOcupados }
//
// nombreTabla es SIEMPRE evento.tabla (el nombre real de la tabla de
// reservas de ESTE evento) — nunca inventado, nunca hardcodeado aquí.
async function obtenerNumeros(nombreTabla) {

    if (!nombreTabla) {
        return { numerosDisponibles: [], numerosOcupados: [] };
    }

    const { data, error } = await supabase
        .from(nombreTabla)
        .select("numero, estado")
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
