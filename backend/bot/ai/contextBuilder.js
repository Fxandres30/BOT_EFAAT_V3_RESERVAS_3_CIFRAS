// Arma el contexto que se envía a la IA a partir de lo que el BOT ya calculó.
// Solo incluye datos ya presentes en ctx/ctx.reserva/ctx.consulta — nunca
// consulta Supabase ni Baileys directamente, y nunca incluye credenciales
// ni datos de sesión.
const { extraerNumeros } = require("../funciones/reservas/extraerNumeros");

function construirContextoReserva(ctx) {

    const reserva = ctx.reserva || null;
    const consulta = ctx.consulta || null;

    const base = {

        cliente: {
            nombre: ctx.usuario?.nombre || null
        },

        evento: {
            nombre: ctx.evento?.nombre_evento || null,
            hora: ctx.evento?.hora_fin || null,
            fecha: ctx.evento?.fecha_evento || null
        },

        mensajeOriginal: ctx.textoOriginal || null

    };

    if (reserva) {

        return {

            ...base,

            resultado: {

                tipo: reserva.ok === true ? "reserva_exitosa" : "reserva_rechazada",

                // Reconstruido con el mismo extractor que ya usa detectarReserva.js,
                // sin modificar ese archivo ni su resultado.
                numerosSolicitados: extraerNumeros(ctx.textoOriginal || ""),

                numerosReservados: reserva.reservados || [],

                numerosYaOcupados: reserva.ocupados || []

            }

        };

    }

    if (consulta) {

        // No se reenvía "mensaje" (es el fallback fijo del BOT, no un dato
        // factual para que Gemini redacte con sus propias palabras).
        const { mensaje, ...datosConsulta } = consulta;

        return {

            ...base,

            resultado: datosConsulta

        };

    }

    return {

        ...base,

        resultado: null

    };

}

module.exports = {
    construirContextoReserva
};
