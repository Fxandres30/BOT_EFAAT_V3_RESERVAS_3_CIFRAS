const { formatHora12 } = require("../../utils/formatHora");

// Sin consulta a Supabase: ctx.evento ya fue resuelto antes en eventHandler.js
// (detectarEvento/consultarEvento). Solo se reutiliza esa información real.
function consultarInfoEvento(evento) {

    const nombre = evento?.nombre_evento || null;
    // 12h para el usuario final — eventos_bot.hora_fin (24h) no se toca.
    const hora = evento?.hora_fin ? formatHora12(evento.hora_fin) : null;
    const fecha = evento?.fecha_evento || null;

    let mensaje;

    if (nombre) {

        mensaje = `Este sorteo es: ${nombre}` + (hora ? `, a las ${hora}` : "") + ".";

    } else {

        mensaje = "No tengo información del evento en este momento.";

    }

    return {
        evento: { nombre, hora, fecha },
        mensaje
    };

}

module.exports = {
    consultarInfoEvento
};
