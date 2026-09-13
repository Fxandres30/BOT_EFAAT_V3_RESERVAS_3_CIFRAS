// Punto de entrada del motor de consultas (solo lectura). Nunca decide con
// IA: cada sub-función consulta datos reales y este archivo arma un
// resultado estructurado con un "mensaje" fijo (fallback determinístico,
// igual patrón que reserva.mensaje en detectarReserva.js). Gemini solo
// redacta a partir de este resultado; nunca lo calcula.
const { consultarMisNumeros, consultarMisNumerosPorEstado } = require("./consultarMisNumeros");
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

async function resolverConsulta({ tipo, numeros, evento, usuario, modo, bucket }) {

    if (!evento || !usuario) {
        return null;
    }

    switch (tipo) {

        // Fase "activar consultas de pago" — reutiliza EXCLUSIVAMENTE
        // consultarMisNumerosPorEstado() (misma consulta que ya usa
        // mis_numeros/cantidad_reservas, solo separada por estado) y
        // ctx.evento.valor, que ya llega resuelto — nunca una tabla ni
        // columna nueva, nunca pagos parciales/abonos/ledger.
        case "consulta_pago": {

            const { total, reservados, pagados } =
                await consultarMisNumerosPorEstado({ evento, usuario });

            // Defaults seguros: si detectarIntencion.js no pudo fijar un
            // modo/bucket explícito (disparadores genéricos, no una de las
            // PAGO_FRASES_EXPLICITAS), "cuánto debo" es la lectura más
            // común de una pregunta de dinero — nunca se deja sin
            // respuesta por falta de un sub-tipo.
            const modoFinal = modo || "monto";
            const bucketFinal = bucket || "pendiente";

            if (modoFinal === "lista") {

                const lista =
                    bucketFinal === "pagado" ? pagados :
                    bucketFinal === "pendiente" ? reservados :
                    [...reservados, ...pagados];

                let mensaje;

                if (lista.length === 0) {

                    mensaje = bucketFinal === "pagado"
                        ? "Todavía no tienes ningún número pagado."
                        : "No tienes ningún número pendiente de pago.";

                } else {

                    mensaje = bucketFinal === "pagado"
                        ? `✅ Números pagados: ${formatearListaNumeros(pagados)}.`
                        : `⏳ Pendientes de pago: ${formatearListaNumeros(reservados)}.`;

                }

                return { tipo, modo: modoFinal, bucket: bucketFinal, total, reservados, pagados, numerosDelUsuario: lista, mensaje };

            }

            if (modoFinal === "cantidad") {

                const cantidad =
                    bucketFinal === "pagado" ? pagados.length :
                    bucketFinal === "pendiente" ? reservados.length :
                    total;

                const sufijo = cantidad === 1 ? "" : "s";

                const mensaje = bucketFinal === "pagado"
                    ? `Tienes ${cantidad} número${sufijo} pagado${sufijo}.`
                    : `Tienes ${cantidad} número${sufijo} pendiente${sufijo} de pago.`;

                return { tipo, modo: modoFinal, bucket: bucketFinal, total, cantidad, mensaje };

            }

            // modo === "monto". NO existen pagos parciales en este sistema
            // (cada número vale evento.valor completo, entero) — por eso
            // la fórmula es siempre cantidad_en_ese_estado * evento.valor,
            // sin abonos ni saldos.
            const valorUnidad = Number(evento.valor) || 0;

            const montoTotal = total * valorUnidad;
            const montoPagado = pagados.length * valorUnidad;
            const montoPendiente = reservados.length * valorUnidad;

            const monto =
                bucketFinal === "pagado" ? montoPagado :
                bucketFinal === "total" ? montoTotal :
                montoPendiente;

            const formateado = `$${monto.toLocaleString("es-CO")}`;

            let mensaje;

            if (bucketFinal === "pagado") {

                mensaje = monto > 0 ? `✅ Has pagado: ${formateado}.` : "Todavía no has pagado nada.";

            } else if (bucketFinal === "total") {

                mensaje = `💰 El total de tus números es: ${formateado}.`;

            } else {

                mensaje = monto > 0 ? `💰 Tienes pendiente por pagar: ${formateado}.` : "No tienes ningún pago pendiente.";

            }

            return { tipo, modo: modoFinal, bucket: bucketFinal, montoTotal, montoPagado, montoPendiente, mensaje };

        }

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
