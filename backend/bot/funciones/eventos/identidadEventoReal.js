const crypto = require("crypto");

// ==========================================================================
// IDENTIDAD DE "EVENTO REAL" — independiente del grupo de WhatsApp donde se
// anunció. Auditoría Identidad Real (2026-09-13): el mismo sorteo (misma
// lotería, hora, valor y fecha) anunciado en varios grupos generaba una
// fila de eventos_bot POR GRUPO, y ninguna consulta de reservas/pagos las
// vinculaba entre sí salvo por accidente (evento.tabla ya es compartida por
// rango de precio, sin distinguir eventos ni tenants).
//
// Mismo algoritmo que automation/eventRules.js::crearIdentidadCiclo (sha256
// de los campos unidos con "|") MENOS grupo_id — ese es exactamente el
// campo que hacía que el mismo sorteo generara una identidad distinta por
// grupo. NO se toca crearIdentidadCiclo ni event_sessions.identidad_ciclo:
// esa identidad SIGUE incluyendo grupo_id a propósito, porque cada grupo
// necesita su propio envío de recordatorios/tabla inicial/cierre (eso es
// correcto tal cual está, no es el mismo problema).
//
// Esta identidad solo sirve para decidir qué filas de eventos_bot (de
// distintos grupos) representan el MISMO sorteo real, y por lo tanto deben
// compartir/aislar correctamente la tabla física de reservas
// (reservarNumeros.js, consultarDisponibilidad.js, consultarReservas.js,
// actualizarEvento.js, verificarTodosPagados.js, consultarMisNumeros.js,
// consultarNumero.js). NO se usa en automation/repo/tablaEvento.js ni en
// routes/tablas.js (COMPARTIR TABLA / INITIAL_TABLE / vista de impresión):
// esos permanecen exactamente como estaban, sin tocar, por instrucción
// explícita.
function crearIdentidadEventoReal({

    usuario_id,
    nombre_evento,
    hora_fin,
    valor,
    fecha_evento

}) {

    const partes = [usuario_id, nombre_evento, hora_fin, valor, fecha_evento]
        .map(v => (v === undefined || v === null) ? "" : String(v));

    return crypto.createHash("sha256").update(partes.join("|")).digest("hex");

}

// Fecha del día OPERATIVO (Colombia), formato YYYY-MM-DD — la que
// guardarEvento() guarda como fecha_evento y entra en esta identidad y en
// identidadCiclo (automation/eventRules.js). Antes era
// new Date().toISOString() (UTC): desde las 19:00 de Colombia ya daba el día
// siguiente, así que el MISMO sorteo publicado antes y después de las 19:00
// tenía dos identidades distintas.
function fechaEventoHoy(ahora = new Date()) {

    return new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Bogota",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).format(ahora);

}

// Fecha del sorteo de un anuncio recién detectado. Desde las 18:00 (hora de
// Colombia), una hora de sorteo que ya pasó hoy se entiende como de mañana:
// por la noche se publican sorteos para la mañana siguiente. En cualquier
// otro caso, hoy (comportamiento de siempre). Si el cierre cae antes de la
// medianoche (sorteo 00:02 -> cierre 23:58), no se aplica: queda hoy.
function fechaSorteoAnunciado(horaFin, horaCierre, ahora = new Date()) {

    const hoy = fechaEventoHoy(ahora);
    const HHMM = /^\d{2}:\d{2}$/;

    if (!HHMM.test(horaFin || "") || !HHMM.test(horaCierre || "") || horaCierre > horaFin) return hoy;

    const horaActual = new Intl.DateTimeFormat("en-GB", {
        timeZone: "America/Bogota",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23"
    }).format(ahora);

    if (horaActual < "18:00" || horaFin >= horaActual) return hoy;

    const [a, m, d] = hoy.split("-").map(Number);

    return new Date(Date.UTC(a, m - 1, d + 1)).toISOString().slice(0, 10);

}

// ¿La fila existente de eventos_bot y el sorteo recién detectado son el
// MISMO sorteo real? Misma identidad que ya usa el sistema (tenant +
// lotería + hora + valor + fecha). Si la fila es previa a la migración 015
// (sin identidad guardada), se recalcula desde sus propios campos.
function esMismoSorteo(filaExistente, detectado) {

    if (!filaExistente || !detectado) return false;

    const identidadExistente =
        filaExistente.identidad_evento_real || crearIdentidadEventoReal(filaExistente);

    return identidadExistente === crearIdentidadEventoReal(detectado);

}

// Valor comparable ("$5.000", 5000, "5000" -> "5000").
function valorComparable(valor) {
    const digitos = String(valor ?? "").replace(/[^\d]/g, "");
    return digitos ? String(Number(digitos)) : "";
}

// ==========================================================================
// Identidad ESTABLE durante el ciclo de vida del sorteo.
//
// buscarSorteoVigente() devuelve la identidad de un sorteo del MISMO tenant
// con la MISMA lotería, hora y valor que sigue ACTIVO (en este grupo o en
// otro), para que un re-anuncio lo continúe en vez de crear otra identidad
// y dejar sus reservas/pagos repartidos en dos "sorteos".
//
// Solo se adopta si el sorteo vigente es del mismo día operativo o no tiene
// hora de cierre (el único caso en que un sorteo sigue activo de un día a
// otro sin que falle nada). Un sorteo de un día anterior que sigue activo
// CON hora de cierre es un cierre fallido, no una continuación: adoptarlo
// mezclaría dos ediciones del mismo sorteo, así que no se adopta.
// Diferencias de lotería/hora/valor nunca se fusionan.
// ==========================================================================
async function buscarSorteoVigente({ supabase, usuarioId, nombre, hora, valor, grupoId, hoy = fechaEventoHoy() }) {

    if (!supabase || !usuarioId || !nombre || !hora) return null;

    const { data, error } = await supabase
        .from("eventos_bot")
        .select("id, grupo_id, identidad_evento_real, fecha_evento, hora_cierre, creado_en, valor")
        .eq("usuario_id", usuarioId)
        .eq("activo", true)
        .eq("nombre_evento", nombre)
        .eq("hora_fin", hora);

    if (error || !data?.length) return null;

    const candidatos = data
        .filter(f => f.identidad_evento_real && valorComparable(f.valor) === valorComparable(valor))
        .filter(f => String(f.fecha_evento) === hoy || !f.hora_cierre);

    if (!candidatos.length) return null;

    // Preferencia: la fila de este mismo grupo; si no, la más antigua.
    const propia = candidatos.find(f => f.grupo_id === grupoId);
    const elegida = propia || [...candidatos].sort((a, b) => String(a.creado_en).localeCompare(String(b.creado_en)))[0];

    return { identidad_evento_real: elegida.identidad_evento_real, fecha_evento: elegida.fecha_evento };

}

module.exports = {
    crearIdentidadEventoReal,
    fechaEventoHoy,
    fechaSorteoAnunciado,
    esMismoSorteo,
    valorComparable,
    buscarSorteoVigente
};
