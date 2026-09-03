// Arma el contexto que se envía a la IA a partir de lo que el BOT ya calculó.
// Solo incluye datos ya presentes en ctx/ctx.reserva — nunca consulta Supabase
// ni Baileys directamente, y nunca incluye credenciales o datos de sesión.
function construirContextoReserva(ctx) {

    const reserva = ctx.reserva || {};

    return {

        cliente: {
            nombre: ctx.usuario?.nombre || null
        },

        evento: {
            nombre: ctx.evento?.nombre_evento || null
        },

        mensajeOriginal: ctx.textoOriginal || null,

        resultado: {

            tipo: "reserva_exitosa",

            numerosReservados: reserva.reservados || [],

            numerosYaOcupados: reserva.ocupados || []

        }

    };

}

module.exports = {
    construirContextoReserva
};
