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

module.exports = {
    crearIdentidadEventoReal
};
