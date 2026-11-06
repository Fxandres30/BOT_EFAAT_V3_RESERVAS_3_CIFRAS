const { fechaEventoHoy } = require("../identidadEventoReal");
const { instanteColombia } = require("../../../../shared/tiempo/colombia");

// Instante (Date) del cierre de reservas: fecha del sorteo + hora_cierre EN
// COLOMBIA (America/Bogota, UTC-5 todo el año: sin horario de verano). Sin
// fecha_evento (sorteos anteriores a esa columna): se juega el día de hoy,
// el comportamiento de siempre. null si no hay hora o no se entiende.
function instanteCierre(evento, ahora = new Date()) {

    if (!evento?.hora_cierre)
        return null;

    const m = String(evento.hora_cierre).trim().match(/^(\d{1,2}):(\d{2})/);

    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59)
        return null;

    const fecha = evento.fecha_evento ? String(evento.fecha_evento).slice(0, 10) : fechaEventoHoy(ahora);
    return instanteColombia(fecha, `${m[1]}:${m[2]}`);

}

// ¿Ya pasó el cierre de reservas? Se compara FECHA Y HORA completas.
// Antes solo la hora del día: un sorteo de un día anterior que no se cerró
// (proceso desconectado a su hora) seguía abierto —aceptando reservas— hasta
// que el reloj volvía a pasar esa hora al día siguiente. Un sorteo de un día
// posterior (publicado de noche para mañana) nunca se cierra antes de tiempo.
function verificarHoraCierre(evento, ahora = new Date()) {

    if (!evento)
        return false;

    const instante = instanteCierre(evento, ahora);

    if (!instante)
        return false;

    return ahora.getTime() >= instante.getTime();

}

// ¿El cierre quedó pendiente de un día ANTERIOR (recuperación)? Ese cierre
// no se anuncia tarde: el aviso de un sorteo de ayer en el grupo de hoy
// confunde (ver estadosGestion.js::cierreSilencioso).
function cierreAtrasado(evento, ahora = new Date()) {

    const instante = instanteCierre(evento, ahora);

    return Boolean(instante) && fechaEventoHoy(instante) < fechaEventoHoy(ahora);

}

module.exports = {
    verificarHoraCierre,
    instanteCierre,
    cierreAtrasado
};
