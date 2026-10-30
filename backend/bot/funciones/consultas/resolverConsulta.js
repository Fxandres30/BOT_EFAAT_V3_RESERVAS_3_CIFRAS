// Punto de entrada del motor de consultas (solo lectura). Nunca decide con
// IA: cada sub-función consulta datos reales y este archivo arma un
// resultado estructurado con un "mensaje" fijo (fallback determinístico,
// igual patrón que reserva.mensaje en detectarReserva.js). Gemini solo
// redacta a partir de este resultado; nunca lo calcula.
const { consultarMisNumerosPorEstado, consultarPendientesOtrosSorteosVerificado } = require("./consultarMisNumeros");
const { determinarEstadoPago } = require("../../../shared/pagos/determinarEstadoPago");
const { consultarNumero } = require("./consultarNumero");
const { consultarDisponibilidad } = require("./consultarDisponibilidad");
const { consultarInfoEvento } = require("./consultarInfoEvento");
const { construirVariablesGramaticales, capitalizar, formatearListaNumeros, formatearGrillaNumeros } = require("../../ai/gramatica");

const TEXTO_ESTADO = {

    libre: n => `El número ${formatearListaNumeros([n])} está libre.`,
    reservado_por_usuario: n => `El número ${formatearListaNumeros([n])} ya lo tienes reservado.`,
    reservado_por_otro: n => `El número ${formatearListaNumeros([n])} está reservado por otra persona.`,
    pagado_por_usuario: n => `El número ${formatearListaNumeros([n])} ya está pagado por ti.`,
    pagado_por_otro: n => `El número ${formatearListaNumeros([n])} ya fue pagado por otra persona.`,
    propio_otro_sorteo: n => `El número ${formatearListaNumeros([n])} lo tienes en otro sorteo; en este no está disponible.`,
    bloqueado: n => `El número ${formatearListaNumeros([n])} está bloqueado y no se puede reservar por ahora.`,
    en_proceso: n => `El número ${formatearListaNumeros([n])} está en proceso y no se puede reservar por ahora.`,
    no_disponible: n => `El número ${formatearListaNumeros([n])} no está disponible.`

};

// Estados que las plantillas de «número específico» del panel ya conocían.
// Cualquier otro (bloqueado, en proceso, de otro sorteo, sin registro...)
// solo lo dice bien el mensaje fijo.
const ESTADOS_CON_PLANTILLA = new Set(["libre", "reservado_por_usuario", "reservado_por_otro", "pagado_por_usuario", "pagado_por_otro"]);

// No se pudo leer: se dice eso, nunca un dato («no tienes números», «no
// quedan números», «0»). Sin plantillas ni Gemini (responderResultado.js).
function consultaConError(tipo) {
    return {
        tipo,
        errorTecnico: true,
        mensaje: "❌ No pude consultar los números en este momento. Intenta nuevamente en unos minutos."
    };
}

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
//
// Sin precio configurado (evento.valor vacío o 0) los montos quedan en
// null: nunca se muestra "$0" ni se inventa un importe — las preguntas de
// dinero se responden con el resumen de números (pagados/pendientes).
// ==========================================================================
function formatearMonto(monto) {
    return `$${monto.toLocaleString("es-CO")}`;
}

// Mensaje fijo de las DOS respuestas de esta familia, ambas construidas
// con los mismos datos de una sola lectura:
//   "numeros"   -> "mis números": todos sus números, cada uno con su estado.
//   "pendiente" -> la respuesta de PAGO ("qué debo", "cuánto debo", "estoy
//                  al día", "¿ya pagué?"): SOLO lo pendiente y su valor si
//                  hay precio; si no queda nada pendiente, lo dice. Nunca
//                  afirma un pago que no esté registrado como "pagado".
// "26/10 22:30" — fecha y hora del sorteo para distinguirlo de otro de la
// misma lotería.
function etiquetaSorteo(o) {
    const fecha = o.fecha_evento ? o.fecha_evento.slice(5, 10).split("-").reverse().join("/") : null;
    const cuando = [fecha, o.hora_fin ? String(o.hora_fin).slice(0, 5) : null].filter(Boolean).join(" ");
    return `${o.nombre || "Sorteo"}${cuando ? ` (${cuando})` : ""}`;
}

// Números pendientes del cliente en OTROS sorteos (consultarPendientesOtrosSorteos).
// "" si no hay ninguno. Lo usa el mensaje fijo y, tras una plantilla del
// panel, responderResultado.js.
// verificados=false: alguna lectura de otros sorteos falló; se dice, para no
// dar a entender que no hay nada pendiente allí.
function textoOtrosPendientes(otros, verificados = true) {

    const aviso = verificados ? [] : ["⚠️ No pude revisar en este momento si tienes pendientes en otros sorteos."];

    if (!otros?.length) return aviso.join("\n");

    const lineas = otros.map(o => {
        const valor = o.montoPendiente != null ? ` — ${formatearMonto(o.montoPendiente)}` : "";
        return `• ${etiquetaSorteo(o)}: ${formatearListaNumeros(o.numeros)}${valor}`;
    });

    return ["⏳ Pendiente en otros sorteos:", ...lineas, ...aviso].join("\n");

}

function construirMensajeResumen({ enfoque, todos, reservados, pagados, montoPendiente, otrosPendientes = [], otrosVerificados = true }) {

    const otros = enfoque === "pendiente" ? textoOtrosPendientes(otrosPendientes, otrosVerificados) : "";

    if (todos.length === 0) {

        if (otros) return ["No tienes números en este sorteo.", otros].join("\n");

        return enfoque === "pendiente"
            ? "No tienes números en este sorteo, así que no debes nada."
            : "No tienes números en este sorteo.";

    }

    if (enfoque === "pendiente") {

        if (reservados.length === 0) {
            return otros
                ? ["✅ En este sorteo estás al día.", otros].join("\n")
                : "✅ Estás al día: no tienes números pendientes de pago.";
        }

        const valor = montoPendiente != null ? ` — ${formatearMonto(montoPendiente)}` : "";
        const propio = `⏳ Te falta pagar: ${formatearListaNumeros(reservados)}${valor}.`;

        return otros ? [propio, otros].join("\n") : propio;

    }

    // "numeros": nunca afirma "reservado" para un número ya pagado
    // (contradicción real corregida antes) — cada número con su estado real.
    const uno = todos.length === 1;
    const g = construirVariablesGramaticales(todos.length);
    const encabezado = `${capitalizar(g.tu_numero_tus_numeros)} ${g.es_son}: ${formatearListaNumeros(todos)}`;

    if (reservados.length === 0) {
        return [encabezado, uno ? "✅ Está pagado." : "✅ Todos están pagados."].join("\n");
    }

    if (pagados.length === 0) {
        return [encabezado, uno ? "⏳ Está pendiente de pago." : "⏳ Todos están pendientes de pago."].join("\n");
    }

    return [
        encabezado,
        `✅ ${pagados.length === 1 ? "Pagado" : "Pagados"}: ${formatearListaNumeros(pagados)}`,
        `⏳ ${reservados.length === 1 ? "Pendiente" : "Pendientes"} de pago: ${formatearListaNumeros(reservados)}`
    ].join("\n");

}

function construirFacetaEstadoNumeros({ tipo, modo, bucket, total, reservados, pagados, valorUnidad, otrosPendientes = [], otrosVerificados = true }) {

    // Montos y estado de pago se calculan SIEMPRE, sin importar el modo
    // (lista/cantidad/monto/resumen): el estado real del usuario (sin_pago/
    // pago_parcial/pago_completo/sin_saldo) es el mismo sin importar qué
    // faceta preguntó — determinarEstadoPago() es la única fuente de
    // verdad, reutilizada también por calcularTipoPresentacion
    // (backend/bot/ai/plantillaMensaje.js) para elegir la categoría de
    // plantilla correcta. Nunca se duplica este cálculo en otro lugar. El
    // estado se decide por CANTIDADES (nunca por montos).
    //
    // Toda faceta devuelve además las listas reservados/pagados y los
    // montos (mismos datos para cualquier variable de plantilla).
    const precioConfigurado = valorUnidad > 0;
    const montoTotal = precioConfigurado ? total * valorUnidad : null;
    const montoPagado = precioConfigurado ? pagados.length * valorUnidad : null;
    const montoPendiente = precioConfigurado ? reservados.length * valorUnidad : null;
    const estadoPago = determinarEstadoPago({
        total,
        cantidadPagados: pagados.length,
        cantidadPendientes: reservados.length
    });

    // Pregunta de dinero sin precio configurado: se responde con los
    // números reales en vez de un importe inventado (lo pendiente, o todos
    // con su estado para "cuánto he pagado"/"cuánto es todo").
    if (modo === "monto" && !precioConfigurado) {
        return construirFacetaEstadoNumeros({ tipo, modo: "resumen", bucket: bucket === "pendiente" ? "pendiente" : "numeros", total, reservados, pagados, valorUnidad });
    }

    if (modo === "resumen") {

        const todos = [...reservados, ...pagados].sort();

        const enfoque = bucket === "pendiente" ? "pendiente" : "numeros";

        const mensaje = construirMensajeResumen({
            enfoque,
            todos,
            reservados,
            pagados,
            montoPendiente,
            otrosPendientes,
            otrosVerificados
        });

        const otros = enfoque === "pendiente" ? (otrosPendientes || []) : [];

        return {
            tipo, modo, bucket, total, reservados, pagados, numerosDelUsuario: todos, mensaje, montoTotal, montoPagado, montoPendiente, estadoPago, precioConfigurado,
            otrosPendientes: otros,
            textoOtrosPendientes: textoOtrosPendientes(otros, enfoque === "pendiente" ? otrosVerificados : true)
        };

    }

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

        return { tipo, modo, bucket, total, cantidad, reservados, pagados, mensaje, montoTotal, montoPagado, montoPendiente, estadoPago };

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

    return { tipo, modo, bucket, total, reservados, pagados, montoTotal, montoPagado, montoPendiente, estadoPago, mensaje };

}

// Deriva (modo, bucket) implícitos para una sub-intención que no trajo un
// modo/bucket explícito (mis_numeros/mis_reservas/cantidad_reservas nunca
// lo traen — consulta_pago siempre lo trae desde detectarIntencion.js).
// Único lugar que conoce esta correspondencia — reutilizado tanto por el
// caso "consulta_pago" en solitario como por "multiple". Un consulta_pago
// sin modo (llamador antiguo) recibe el resumen de lo pendiente, nunca
// solo un monto.
function modoBucketImplicitos(tipo, modo, bucket) {

    // La respuesta general es la misma sola o combinada: todos sus números
    // con su estado (ver caso mis_numeros más abajo).
    if (!modo && (tipo === "mis_numeros" || tipo === "mis_reservas")) {
        return { modo: "resumen", bucket: "numeros" };
    }

    return {
        modo: modo || (tipo === "cantidad_reservas" ? "cantidad" : tipo === "consulta_pago" ? "resumen" : "lista"),
        bucket: bucket || (tipo === "consulta_pago" ? "pendiente" : "total")
    };

}

// Respuesta combinada = sus partes, una por línea. Único lugar que la
// arma: también la usa eventHandler.js al omitir una parte no habilitada.
function componerCombinada(base, resultados) {
    return { ...base, resultados, mensaje: resultados.map(r => r.mensaje).join("\n") };
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
            if (datos.errorLectura) return consultaConError(tipo);
            const valorUnidad = Number(evento.valor) || 0;

            // La respuesta general (mis_numeros/mis_reservas: todos, pagados
            // y pendientes) ya contiene cualquier LISTA de la familia
            // ("mis números y cuáles ya pagué"): no se repite. Solo cuando
            // la general sigue habilitada — eventHandler ya quitó las
            // apagadas — y nunca cantidades ni montos, que sí aportan.
            const incluyeGeneral = (intenciones || []).some(s => s.tipo === "mis_numeros" || s.tipo === "mis_reservas");

            const sinRepetir = (intenciones || []).filter(sub =>
                !(incluyeGeneral && sub.tipo === "consulta_pago" && sub.modo === "lista")
            );

            const resultados = sinRepetir.map(sub => {

                const { modo: modoSub, bucket: bucketSub } = modoBucketImplicitos(sub.tipo, sub.modo, sub.bucket);

                return construirFacetaEstadoNumeros({
                    tipo: sub.tipo,
                    modo: modoSub,
                    bucket: bucketSub,
                    ...datos,
                    valorUnidad
                });

            });

            return componerCombinada({ tipo, ...datos }, resultados);

        }

        // Fase "activar consultas de pago" — reutiliza EXCLUSIVAMENTE
        // consultarMisNumerosPorEstado() (misma consulta que ya usa
        // mis_numeros/cantidad_reservas, solo separada por estado) y
        // ctx.evento.valor, que ya llega resuelto — nunca una tabla ni
        // columna nueva, nunca pagos parciales/abonos/ledger.
        case "consulta_pago": {

            const datos = await consultarMisNumerosPorEstado({ evento, usuario });
            if (datos.errorLectura) return consultaConError(tipo);
            const valorUnidad = Number(evento.valor) || 0;

            const { modo: modoFinal, bucket: bucketFinal } = modoBucketImplicitos(tipo, modo, bucket);

            // La respuesta de pago ("qué debo", "cuánto me falta", "estoy al
            // día") también muestra lo pendiente en OTROS sorteos del mismo
            // cliente: nunca "no debes nada" a quien sí debe. Si no se
            // pudieron revisar, se avisa (y una plantilla de «al día» no se usa).
            const otros = modoFinal === "resumen" && bucketFinal === "pendiente"
                ? await consultarPendientesOtrosSorteosVerificado({ evento, usuario })
                : { ok: true, lista: [] };

            return construirFacetaEstadoNumeros({ tipo, modo: modoFinal, bucket: bucketFinal, ...datos, valorUnidad, otrosPendientes: otros.lista, otrosVerificados: otros.ok });

        }

        // mis_numeros y mis_reservas: mismos datos (una lectura) y mismo
        // resumen — cada número con su estado REAL (pagado / pendiente).
        // Conservan su propio tipo para que el panel siga usando sus
        // plantillas e interruptores.
        case "mis_numeros":
        case "mis_reservas": {

            const datos = await consultarMisNumerosPorEstado({ evento, usuario });
            if (datos.errorLectura) return consultaConError(tipo);

            return construirFacetaEstadoNumeros({
                tipo,
                modo: "resumen",
                bucket: "numeros",
                ...datos,
                valorUnidad: Number(evento.valor) || 0
            });

        }

        case "cantidad_reservas": {

            const datos = await consultarMisNumerosPorEstado({ evento, usuario });
            if (datos.errorLectura) return consultaConError(tipo);
            const cantidad = datos.total;

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

            if (resultado.estadoReal === "error_lectura") return consultaConError(tipo);

            // sin_registro, duplicado o un estado desconocido: no disponible.
            const texto = TEXTO_ESTADO[resultado.estadoReal] || TEXTO_ESTADO.no_disponible;

            return {
                tipo,
                ...resultado,
                mensaje: texto(resultado.numero),
                ...(ESTADOS_CON_PLANTILLA.has(resultado.estadoReal) ? {} : { soloMensajeFijo: true })
            };

        }

        case "disponibilidad": {

            const { numerosDisponibles, numerosOcupados, errorLectura } =
                await consultarDisponibilidad({ evento });

            // No se pudo leer, o la cuadrícula del cliente no tiene ninguna
            // fila (integridad): no se afirma «no quedan números».
            if (errorLectura || (numerosDisponibles.length === 0 && numerosOcupados.length === 0)) {
                if (!errorLectura) console.warn(`⚠️ [CONSULTA] la cuadrícula ${evento.tabla} del cliente ${evento.usuario_id} no tiene filas.`);
                return consultaConError(tipo);
            }

            let mensaje;

            // AGOTADO: la consulta SÍ trajo la tabla (hay números ocupados/
            // reservados/pagados) y ninguno está libre. Es un estado válido,
            // no un error: responderResultado() envía este mensaje tal cual,
            // sin plantillas de "números disponibles" ni Gemini.
            //
            // Ambas listas vacías NO es agotado: es lo que devuelve
            // consultarDisponibilidad() ante un error de Supabase o un evento
            // sin tabla (una tabla real siempre trae sus números) — se
            // mantiene el comportamiento de siempre.
            const agotado = numerosDisponibles.length === 0 && numerosOcupados.length > 0;

            if (agotado) {

                mensaje = [
                    "🚫 *NÚMEROS AGOTADOS*",
                    "",
                    "Familia, en este momento ya no hay números disponibles para este sorteo. ❤️",
                    "",
                    "Todos los numeritos se encuentran ocupados o vendidos.",
                    "",
                    "📢 Estén pendientes de nuestros próximos sorteos."
                ].join("\n");

                return { tipo, numerosDisponibles, numerosOcupados, mensaje, agotado: true };

            }

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
    resolverConsulta,
    componerCombinada,
    textoOtrosPendientes
};
