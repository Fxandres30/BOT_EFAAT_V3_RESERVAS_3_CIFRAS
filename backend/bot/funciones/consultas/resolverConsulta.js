// Punto de entrada del motor de consultas (solo lectura). Nunca decide con
// IA: cada sub-función consulta datos reales y este archivo arma un
// resultado estructurado con un "mensaje" fijo (fallback determinístico,
// igual patrón que reserva.mensaje en detectarReserva.js). Gemini solo
// redacta a partir de este resultado; nunca lo calcula.
const { consultarMisNumeros } = require("./consultarMisNumeros");
const { consultarCantidad } = require("./consultarCantidad");
const { consultarNumero } = require("./consultarNumero");
const { consultarDisponibilidad } = require("./consultarDisponibilidad");
const { consultarInfoEvento } = require("./consultarInfoEvento");
const { construirVariablesGramaticales, capitalizar, formatearListaNumeros } = require("../../ai/gramatica");

const TEXTO_ESTADO = {

    libre: n => `El número ${formatearListaNumeros([n])} está libre.`,
    reservado_por_usuario: n => `El número ${formatearListaNumeros([n])} ya lo tienes reservado.`,
    reservado_por_otro: n => `El número ${formatearListaNumeros([n])} está reservado por otra persona.`,
    pagado_por_usuario: n => `El número ${formatearListaNumeros([n])} ya está pagado por ti.`,
    pagado_por_otro: n => `El número ${formatearListaNumeros([n])} ya fue pagado por otra persona.`

};

async function resolverConsulta({ tipo, numeros, evento, usuario }) {

    if (!evento || !usuario) {
        return null;
    }

    switch (tipo) {

        case "mis_numeros":
        case "mis_reservas": {

            const numerosDelUsuario = await consultarMisNumeros({ evento, usuario });

            const cantidad = numerosDelUsuario.length;

            let mensaje;

            if (cantidad === 0) {

                mensaje = "No tienes números reservados actualmente.";

            } else {

                // Fuente única de verdad para singular/plural (gramatica.js)
                // — nunca una rama ad-hoc distinta a la de plantillaMensaje.js.
                const g = construirVariablesGramaticales(cantidad);

                mensaje = `${capitalizar(g.tu_numero_tus_numeros)} ${g.reservado_reservados} ${g.es_son}: ${formatearListaNumeros(numerosDelUsuario)}`;

            }

            return { tipo, numerosDelUsuario, mensaje };

        }

        case "cantidad_reservas": {

            const cantidad = await consultarCantidad({ evento, usuario });

            const g = construirVariablesGramaticales(cantidad);

            const mensaje = `Tienes ${cantidad} ${g.numero_numeros} ${g.reservado_reservados}.`;

            return { tipo, cantidad, mensaje };

        }

        case "numero_especifico": {

            const numero = numeros?.[0] || null;

            if (!numero) {
                return null;
            }

            const resultado = await consultarNumero({ evento, usuario, numero });

            if (!resultado) {
                return null;
            }

            const texto = TEXTO_ESTADO[resultado.estadoReal];

            const mensaje = texto
                ? texto(resultado.numero)
                : `El número ${formatearListaNumeros([resultado.numero])} tiene estado: ${resultado.estadoReal}.`;

            return { tipo, ...resultado, mensaje };

        }

        case "disponibilidad": {

            const { numerosDisponibles, numerosOcupados } =
                await consultarDisponibilidad({ evento });

            let mensaje;

            if (numerosDisponibles.length === 0) {

                mensaje = "No quedan números disponibles.";

            } else {

                const g = construirVariablesGramaticales(numerosDisponibles.length);

                mensaje = `${capitalizar(g.numero_numeros)} ${g.disponible_disponibles} (${numerosDisponibles.length}): ${formatearListaNumeros(numerosDisponibles)}`;

            }

            return { tipo, numerosDisponibles, numerosOcupados, mensaje };

        }

        case "info_evento": {

            const resultado = consultarInfoEvento(evento);

            return { tipo, ...resultado };

        }

        default:

            return null;

    }

}

module.exports = {
    resolverConsulta
};
