// Arma el contexto que se envía a la IA a partir de lo que el BOT ya calculó.
// Solo incluye datos ya presentes en ctx/ctx.reserva/ctx.consulta — nunca
// consulta Supabase ni Baileys directamente, y nunca incluye credenciales
// ni datos de sesión.
const { extraerNumeros } = require("../funciones/reservas/extraerNumeros");
const { construirVariablesGramaticales, calcularNumerosRelevantes } = require("./gramatica");

// Gramática explícita para Gemini: la MISMA fuente de verdad que usa
// plantillaMensaje.js (calcularNumerosRelevantes), nunca una cuenta
// recalculada aparte. Gemini debe usar EXACTAMENTE estas formas y esta
// cantidad — nunca inventar ni corregir singular/plural por su cuenta
// (ver instrucción en prompts/efaat.txt).
function construirGramaticaParaIA(ctx, resultado) {

    const {
        cantidadPropiedad,
        cantidadNumeros,
        cantidadReservados,
        cantidadOcupados,
        cantidadDisponibles
    } = calcularNumerosRelevantes(ctx, resultado);

    return {
        cantidadPropiedad,
        cantidadNumeros,
        formasPropiedad: construirVariablesGramaticales(cantidadPropiedad),
        formasGenerales: construirVariablesGramaticales(cantidadNumeros),

        // Fase 2 — cantidades INDEPENDIENTES por lista. reserva_parcial es
        // el caso real: numerosReservados y numerosOcupados pueden tener
        // cantidades distintas en la MISMA respuesta. Gemini debe usar
        // cada una para concordar SOLO con su propia lista — la cantidad
        // de una nunca determina la concordancia de la otra.
        cantidadReservados,
        cantidadOcupados,
        cantidadDisponibles,
        formasReservados: construirVariablesGramaticales(cantidadReservados),
        formasOcupados: construirVariablesGramaticales(cantidadOcupados),
        formasDisponibles: construirVariablesGramaticales(cantidadDisponibles)
    };

}

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

                numerosYaOcupados: reserva.ocupados || [],

                gramatica: construirGramaticaParaIA(ctx, reserva)

            }

        };

    }

    if (consulta) {

        // No se reenvía "mensaje" (es el fallback fijo del BOT, no un dato
        // factual para que Gemini redacte con sus propias palabras).
        const { mensaje, ...datosConsulta } = consulta;

        return {

            ...base,

            resultado: {
                ...datosConsulta,
                gramatica: construirGramaticaParaIA(ctx, consulta)
            }

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
