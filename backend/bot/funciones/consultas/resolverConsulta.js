// Punto de entrada del motor de consultas (solo lectura). Nunca decide con
// IA: cada sub-función consulta datos reales y este archivo arma un
// resultado estructurado con un "mensaje" fijo (fallback determinístico,
// igual patrón que reserva.mensaje en detectarReserva.js). Gemini solo
// redacta a partir de este resultado; nunca lo calcula.
const { consultarMisNumeros, consultarMisNumerosPorEstado } = require("./consultarMisNumeros");
const { determinarEstadoPago } = require("../../../shared/pagos/determinarEstadoPago");
const { consultarCantidad } = require("./consultarCantidad");
const { consultarNumero } = require("./consultarNumero");
const { consultarDisponibilidad } = require("./consultarDisponibilidad");
const { consultarInfoEvento } = require("./consultarInfoEvento");
const { construirVariablesGramaticales, capitalizar, formatearListaNumeros, formatearGrillaNumeros } = require("../../ai/gramatica");

const TEXTO_ESTADO = {

    libre: n => `El número ${formatearListaNumeros([n])} está libre.`,
    reservado_por_usuario: n => `El número ${formatearListaNumeros([n])} ya lo tienes reservado.`,
    reservado_por_otro: n => `El número ${formatearListaNumeros([n])} está reservado por otra persona.`,
    pagado_por_usuario: n => `El número ${formatearListaNumeros([n])} ya está pagado por ti.`,
    pagado_por_otro: n => `El número ${formatearListaNumeros([n])} ya fue pagado por otra persona.`

};

// ==========================================================================
// construirFacetaEstadoNumeros() — ÚNICA función que decide texto/datos
// para una faceta (modo: lista/cantidad/monto × bucket: pendiente/pagado/
// total) a partir de una MISMA foto de datos (total/reservados/pagados).
//
// Existe para que la corrección "contradicción real" quede estructuralmente
// imposible: tanto el caso "consulta_pago" en solitario como cada parte de
// una consulta COMBINADA ("mis números y cuánto debo") llaman a esta misma
// función con los MISMOS reservados/pagados obtenidos en una única lectura
// — nunca dos lecturas separadas que puedan divergir entre sí.
//
// NO existen pagos parciales en este sistema (cada número vale
// evento.valor completo) — por eso el monto es siempre
// cantidad_en_ese_estado * evento.valor, sin abonos ni saldos.
// ==========================================================================
function construirFacetaEstadoNumeros({ tipo, modo, bucket, total, reservados, pagados, valorUnidad }) {

    // Montos y estado de pago se calculan SIEMPRE, sin importar el modo
    // (lista/cantidad/monto): el estado real del usuario (sin_pago/
    // pago_parcial/pago_completo/sin_saldo) es el mismo sin importar qué
    // faceta preguntó — determinarEstadoPago() es la única fuente de
    // verdad, reutilizada también por calcularTipoPresentacion
    // (backend/bot/ai/plantillaMensaje.js) para elegir la categoría de
    // plantilla correcta. Nunca se duplica este cálculo en otro lugar.
    const montoTotal = total * valorUnidad;
    const montoPagado = pagados.length * valorUnidad;
    const montoPendiente = reservados.length * valorUnidad;
    const estadoPago = determinarEstadoPago({ total, montoTotal, montoPagado, montoPendiente });

    if (modo === "lista") {

        // bucket "total" une reservados+pagados — se reordena porque cada
        // arreglo ya viene ascendente POR SEPARADO (misma consulta que
        // consultarMisNumerosPorEstado.js), pero concatenados quedarían
        // agrupados por estado en vez de en orden numérico. Los números
        // son strings de igual longitud (canonicalizados por
        // extraerNumeros.js/reservarNumeros.js), así que un sort()
        // lexicográfico ya es un sort numérico correcto.
        const lista =
            bucket === "pagado" ? pagados :
            bucket === "pendiente" ? reservados :
            [...reservados, ...pagados].sort();

        let mensaje;

        if (lista.length === 0) {

            mensaje =
                bucket === "pagado" ? "Todavía no tienes ningún número pagado." :
                bucket === "pendiente" ? "No tienes ningún número pendiente de pago." :
                "No tienes números reservados actualmente.";

        } else if (bucket === "pagado") {

            mensaje = `✅ Números pagados: ${formatearListaNumeros(pagados)}.`;

        } else if (bucket === "pendiente") {

            mensaje = `⏳ Pendientes de pago: ${formatearListaNumeros(reservados)}.`;

        } else {

            // bucket==="total": SOLO se listan los números — nunca se
            // afirma un estado (ni "reservados" ni "pagados"), porque esta
            // lista mezcla ambos a propósito. Afirmar "reservados" aquí
            // era exactamente la contradicción real detectada: un número
            // YA PAGADO seguía apareciendo como "reservado".
            const g = construirVariablesGramaticales(lista.length);

            mensaje = `${capitalizar(g.tu_numero_tus_numeros)} ${g.es_son}: ${formatearListaNumeros(lista)}`;

        }

        return { tipo, modo, bucket, total, reservados, pagados, numerosDelUsuario: lista, mensaje, montoTotal, montoPagado, montoPendiente, estadoPago };

    }

    if (modo === "cantidad") {

        const cantidad =
            bucket === "pagado" ? pagados.length :
            bucket === "pendiente" ? reservados.length :
            total;

        const sufijo = cantidad === 1 ? "" : "s";

        const mensaje =
            bucket === "pagado" ? `Tienes ${cantidad} número${sufijo} pagado${sufijo}.` :
            bucket === "pendiente" ? `Tienes ${cantidad} número${sufijo} pendiente${sufijo} de pago.` :
            `Tienes ${cantidad} número${sufijo} en total.`;

        return { tipo, modo, bucket, total, cantidad, mensaje, montoTotal, montoPagado, montoPendiente, estadoPago };

    }

    // modo === "monto"
    const monto =
        bucket === "pagado" ? montoPagado :
        bucket === "total" ? montoTotal :
        montoPendiente;

    const formateado = `$${monto.toLocaleString("es-CO")}`;

    let mensaje;

    if (bucket === "pagado") {

        mensaje = monto > 0 ? `✅ Has pagado: ${formateado}.` : "Todavía no has pagado nada.";

    } else if (bucket === "total") {

        mensaje = `💰 El total de tus números es: ${formateado}.`;

    } else {

        // bucket === "pendiente" — el caso por defecto de "consulta de
        // pago" ("cuánto debo"). El texto depende del ESTADO REAL
        // (estadoPago), NUNCA de una plantilla universal: pago_completo
        // jamás dice "te falta $0", y sin_saldo nunca reutiliza el texto
        // de pago_parcial/sin_pago (ver auditoría "consulta de pago
        // contextual").
        if (estadoPago === "pago_completo") {

            mensaje = "✅ Ya pagaste el total. No tienes ningún saldo pendiente.";

        } else if (estadoPago === "sin_saldo") {

            mensaje = "No tienes reservas activas ni ningún pago pendiente.";

        } else {

            mensaje = `💰 Tienes pendiente por pagar: ${formateado}.`;

        }

    }

    return { tipo, modo, bucket, montoTotal, montoPagado, montoPendiente, estadoPago, mensaje };

}

// Deriva (modo, bucket) implícitos para una sub-intención que no trajo un
// modo/bucket explícito (mis_numeros/mis_reservas/cantidad_reservas nunca
// lo traen — solo consulta_pago puede, vía PAGO_FRASES_EXPLICITAS). Único
// lugar que conoce esta correspondencia — reutilizado tanto por el caso
// "consulta_pago" en solitario como por "multiple".
function modoBucketImplicitos(tipo, modo, bucket) {

    return {
        modo: modo || (tipo === "cantidad_reservas" ? "cantidad" : tipo === "consulta_pago" ? "monto" : "lista"),
        bucket: bucket || (tipo === "consulta_pago" ? "pendiente" : "total")
    };

}

async function resolverConsulta({ tipo, numeros, evento, usuario, modo, bucket, intenciones }) {

    if (!evento || !usuario) {
        return null;
    }

    switch (tipo) {

        // Fase "consultas combinadas" — UNA sola lectura de Supabase para
        // TODAS las sub-intenciones del mensaje, así es estructuralmente
        // imposible que dos partes de la misma respuesta se contradigan
        // (comparten exactamente los mismos reservados/pagados).
        case "multiple": {

            const datos = await consultarMisNumerosPorEstado({ evento, usuario });
            const valorUnidad = Number(evento.valor) || 0;

            const resultados = (intenciones || []).map(sub => {

                const { modo: modoSub, bucket: bucketSub } = modoBucketImplicitos(sub.tipo, sub.modo, sub.bucket);

                return construirFacetaEstadoNumeros({
                    tipo: sub.tipo,
                    modo: modoSub,
                    bucket: bucketSub,
                    ...datos,
                    valorUnidad
                });

            });

            const mensaje = resultados.map(r => r.mensaje).join("\n");

            return { tipo, ...datos, resultados, mensaje };

        }

        // Fase "activar consultas de pago" — reutiliza EXCLUSIVAMENTE
        // consultarMisNumerosPorEstado() (misma consulta que ya usa
        // mis_numeros/cantidad_reservas, solo separada por estado) y
        // ctx.evento.valor, que ya llega resuelto — nunca una tabla ni
        // columna nueva, nunca pagos parciales/abonos/ledger.
        case "consulta_pago": {

            const datos = await consultarMisNumerosPorEstado({ evento, usuario });
            const valorUnidad = Number(evento.valor) || 0;

            const { modo: modoFinal, bucket: bucketFinal } = modoBucketImplicitos(tipo, modo, bucket);

            return construirFacetaEstadoNumeros({ tipo, modo: modoFinal, bucket: bucketFinal, ...datos, valorUnidad });

        }

        case "mis_numeros":
        case "mis_reservas": {

            const numerosDelUsuario = await consultarMisNumeros({ evento, usuario });

            const cantidad = numerosDelUsuario.length;

            let mensaje;

            if (cantidad === 0) {

                mensaje = "No tienes números reservados actualmente.";

            } else {

                // CORRECCIÓN — contradicción real detectada: antes decía
                // siempre "reservado(s)" aunque el número YA estuviera
                // pagado (esta función mezcla reservado+pagado a
                // propósito, ver consultarMisNumeros.js). El estado real
                // por separado ya lo reportan "cuáles pagados"/"cuáles
                // pendientes" (consulta_pago, más arriba) — aquí solo se
                // listan los números, SIN afirmar un estado que podría ser
                // falso.
                const g = construirVariablesGramaticales(cantidad);

                mensaje = `${capitalizar(g.tu_numero_tus_numeros)} ${g.es_son}: ${formatearListaNumeros(numerosDelUsuario)}`;

            }

            return { tipo, numerosDelUsuario, mensaje };

        }

        case "cantidad_reservas": {

            const cantidad = await consultarCantidad({ evento, usuario });

            const g = construirVariablesGramaticales(cantidad);

            // Misma corrección que mis_numeros: no afirmar "reservados"
            // cuando el conteo puede incluir números ya pagados.
            const mensaje = `Tienes ${cantidad} ${g.numero_numeros} en total.`;

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

                // Mensaje fijo de respaldo (sin plantilla configurada) — usa
                // la misma grilla de 3 filas que {{numeros_disponibles}}
                // (ver gramatica.js::formatearGrillaNumeros), para que la
                // presentación mejorada aplique también sin necesidad de
                // configurar ninguna plantilla en el panel.
                mensaje = `${capitalizar(g.numero_numeros)} ${g.disponible_disponibles} (${numerosDisponibles.length}):\n${formatearGrillaNumeros(numerosDisponibles)}`;

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
