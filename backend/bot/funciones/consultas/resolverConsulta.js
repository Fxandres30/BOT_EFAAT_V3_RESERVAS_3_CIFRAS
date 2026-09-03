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

const TEXTO_ESTADO = {

    libre: n => `El número ${n} está libre.`,
    reservado_por_usuario: n => `El número ${n} ya lo tienes reservado.`,
    reservado_por_otro: n => `El número ${n} está reservado por otra persona.`,
    pagado_por_usuario: n => `El número ${n} ya está pagado por ti.`,
    pagado_por_otro: n => `El número ${n} ya fue pagado por otra persona.`

};

async function resolverConsulta({ tipo, numeros, evento, usuario }) {

    if (!evento || !usuario) {
        return null;
    }

    switch (tipo) {

        case "mis_numeros":
        case "mis_reservas": {

            const numerosDelUsuario = await consultarMisNumeros({ evento, usuario });

            const mensaje = numerosDelUsuario.length
                ? `Tus números reservados son: ${numerosDelUsuario.join(", ")}`
                : "No tienes números reservados actualmente.";

            return { tipo, numerosDelUsuario, mensaje };

        }

        case "cantidad_reservas": {

            const cantidad = await consultarCantidad({ evento, usuario });

            const mensaje = `Tienes ${cantidad} número${cantidad === 1 ? "" : "s"} reservado${cantidad === 1 ? "" : "s"}.`;

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
                : `El número ${resultado.numero} tiene estado: ${resultado.estadoReal}.`;

            return { tipo, ...resultado, mensaje };

        }

        case "disponibilidad": {

            const { numerosDisponibles, numerosOcupados } =
                await consultarDisponibilidad({ evento });

            const mensaje = numerosDisponibles.length
                ? `Números disponibles (${numerosDisponibles.length}): ${numerosDisponibles.join(", ")}`
                : "No quedan números disponibles.";

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
