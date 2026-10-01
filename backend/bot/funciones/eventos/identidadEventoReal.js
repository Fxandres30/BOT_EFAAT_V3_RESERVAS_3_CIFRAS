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

module.exports = {
    crearIdentidadEventoReal,
    fechaEventoHoy,
    esMismoSorteo
};
