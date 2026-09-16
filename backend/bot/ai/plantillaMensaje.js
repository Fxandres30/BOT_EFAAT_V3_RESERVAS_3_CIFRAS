// Variables reales disponibles para plantillas de mensajes (Fase 5.2).
// Nunca inventa datos: si un dato no existe para ese tipo de resultado,
// la variable queda vacía (nunca se rellena con un valor inventado).
const { construirVariablesGramaticales, construirVariablesPorConjunto, calcularNumerosRelevantes, formatearListaNumeros, formatearGrillaNumeros } = require("./gramatica");
const { extraerNumeros } = require("../funciones/reservas/extraerNumeros");
const { formatHora12 } = require("../utils/formatHora");
const { construirContextoGlobal } = require("../../shared/variables/contextoVariables");
const { resolverVariablesOrfanas, aplicarModificadorTexto } = require("../../shared/variables/resolverVariables");
const catalogo = require("../../shared/variables/catalogoVariables");

const MOSTRAR_POR_VARIABLE = {

    cliente: "mostrar_nombre",
    evento: "mostrar_evento",
    numeros_solicitados: "mostrar_numeros_solicitados",
    numeros_reservados: "mostrar_numeros_reservados",
    numeros_ocupados: "mostrar_numeros_ocupados",
    numeros_disponibles: "mostrar_numeros_disponibles",
    fecha: "mostrar_fecha",
    hora: "mostrar_hora",
    precio: "mostrar_precio"

    // Las variables de pago/estado (monto_total, numeros_pagados, etc.)
    // no tienen un toggle "mostrar_*" propio todavía — igual que
    // "cantidad"/"cantidad_reservados", se muestran siempre que resuelvan
    // con datos reales (ver catálogo global, backend/shared/variables).
    // No es una omisión: agregar un toggle por variable nueva es una
    // decisión de UI aparte, no una necesaria para conectarlas.

};

// catalogoExtra (opcional, Fase "Variables Globales"): variables dinámicas
// del usuario (variables_globales, ya normalizadas — ver
// catalogoVariables.js::normalizarVariableDinamica), obtenidas por el
// llamador (responderResultado.js) ANTES de construir el mensaje. Si se
// omite (todo el código/tests que no la conoce todavía), el comportamiento
// es exactamente el mismo que antes de esta fase.
function construirVariables(ctx, resultado, catalogoExtra) {

    // Fuente única de verdad (gramatica.js) para saber cuántos números
    // están involucrados en esta respuesta — la misma que usa
    // contextBuilder.js para informar a Gemini. Nunca se recalcula aquí.
    const {
        numerosSolicitados,
        numerosReservados,
        numerosOcupados,
        numerosDisponibles,
        cantidadPropiedad,
        cantidadNumeros,
        cantidadReservados,
        cantidadOcupados,
        cantidadDisponibles
    } = calcularNumerosRelevantes(ctx, resultado);

    // "tu_numero_tus_numeros" es de PROPIEDAD (números del cliente): no
    // aplica a números de otros, por eso usa cantidadPropiedad y no
    // cantidadNumeros (en "disponibilidad" cantidadPropiedad siempre es 0).
    // El resto de pares gramaticales son neutros (número/está/reservado/...)
    // y usan cantidadNumeros, que sí cubre disponibilidad.
    const formasPropiedad = construirVariablesGramaticales(cantidadPropiedad);
    const formasGenerales = construirVariablesGramaticales(cantidadNumeros);

    // Fase 2 — variables con sufijo "_reservados"/"_ocupados"/"_disponibles":
    // cada una concuerda SIEMPRE con SU propia lista, nunca con la de otro
    // conjunto ni con cantidadPropiedad/cantidadNumeros. Necesarias para
    // plantillas que mencionan más de una lista en el mismo mensaje
    // (reserva_parcial: reservados Y ocupados; disponibilidad: disponibles
    // Y ocupados) — ahí una sola cantidad global ya no alcanza.
    const formasPorConjunto = construirVariablesPorConjunto({
        reservados: cantidadReservados,
        ocupados: cantidadOcupados,
        disponibles: cantidadDisponibles
    });

    // Variables globales "huérfanas" conectadas en esta fase (monto_total,
    // numeros_pagados, cantidad_pendientes, etc. — ver auditoría "SISTEMA
    // GLOBAL DE VARIABLES EFAAT"). Se calculan por separado, vía el
    // resolver global (backend/shared/variables), y se colocan ANTES de
    // las variables ya existentes: si alguna vez coincidiera un nombre,
    // el comportamiento histórico de abajo gana siempre — cero riesgo de
    // cambiar una plantilla que ya funciona hoy.
    const variablesGlobalesOrfanas = resolverVariablesOrfanas(construirContextoGlobal(ctx), catalogoExtra);

    return {

        ...variablesGlobalesOrfanas,

        cliente: ctx.usuario?.nombre || "",
        evento: ctx.evento?.nombre_evento || "",
        numeros_solicitados: formatearListaNumeros(numerosSolicitados),
        numeros_reservados: formatearListaNumeros(numerosReservados),
        numeros_ocupados: formatearListaNumeros(numerosOcupados),
        // Único caso con formato propio: grilla de 3 filas visualmente
        // equilibradas (ver gramatica.js::formatearGrillaNumeros), para
        // mejorar la presentación del mensaje "Disponibles". El resto de
        // listas (solicitados/reservados/ocupados) sigue con
        // formatearListaNumeros "( 27 - 45 )", sin cambios — numerosDisponibles
        // solo se llena cuando resultado.tipo==="disponibilidad" (ver
        // gramatica.js::calcularNumerosRelevantes), así que este cambio no
        // afecta ninguna otra plantilla existente.
        numeros_disponibles: formatearGrillaNumeros(numerosDisponibles),
        fecha: ctx.evento?.fecha_evento || "",
        // Presentación 12h para el usuario final — el valor almacenado
        // (eventos_bot.hora_fin, 24h) no se toca.
        hora: formatHora12(ctx.evento?.hora_fin),
        // "precio" es el valor por número del evento (dato real, eventos_bot.valor).
        precio: ctx.evento?.valor != null ? String(ctx.evento.valor) : "",
        cantidad: resultado?.cantidad != null ? String(resultado.cantidad) : "",
        cantidad_reservados: String(cantidadReservados),
        cantidad_ocupados: String(cantidadOcupados),
        cantidad_disponibles: String(cantidadDisponibles),

        ...formasGenerales,
        tu_numero_tus_numeros: formasPropiedad.tu_numero_tus_numeros,
        ...formasPorConjunto

    };

}

// Sustituye {{variable}} (o {{variable|modificador}}, Fase "Variables
// Globales" — lower/upper/capitalize/title) por su valor real.
// "opcionesMostrar" es el objeto JSONB de la columna
// plantillas_mensaje.variables (Fase 5.3): si su mostrar_* correspondiente
// es false, se reemplaza por cadena vacía (nunca se deja "{{...}}" literal
// ni se inventa un valor). catalogoExtra (opcional): variables dinámicas
// del usuario, para que el fallback de alias también las reconozca.
function aplicarPlantilla(plantilla, variables, opcionesMostrar = {}, catalogoExtra) {

    if (typeof plantilla !== "string" || !plantilla.trim()) {
        return null;
    }

    return plantilla.replace(/\{\{\s*(\w+)(?:\|(\w+))?\s*\}\}/g, (_match, nombre, modificador) => {

        // Si el nombre escrito es un ALIAS del catálogo global (p. ej.
        // "nombre_evento"/"loteria" -> "evento", "valor"/"valor_numero" ->
        // "precio") en vez de la clave con la que este objeto ya viene
        // armado, se resuelve al MISMO dato real bajo su clave canónica —
        // nunca se recalcula ni se inventa un valor nuevo. Antes de este
        // cambio, escribir un alias aquí (fuera de las variables "NUEVA"
        // ya conectadas vía resolverVariablesOrfanas) quedaba silenciosamente
        // vacío, aunque el catálogo lo documentara como válido.
        const claveReal = variables[nombre] !== undefined
            ? nombre
            : (catalogo.resolverClaveCanonica(nombre, catalogoExtra)?.definicion?.key ?? nombre);

        const campoMostrar = MOSTRAR_POR_VARIABLE[nombre] || MOSTRAR_POR_VARIABLE[claveReal];

        if (campoMostrar && opcionesMostrar[campoMostrar] === false) {
            return "";
        }

        const valor = variables[claveReal];

        const valorSeguro = valor !== undefined && valor !== null ? valor : "";

        return aplicarModificadorTexto(valorSeguro, modificador);

    });

}

// Deriva el tipo de PRESENTACIÓN (10 categorías configurables desde el
// panel) a partir de datos que YA existen en resultado/ctx — nunca decide
// negocio, solo etiqueta con más detalle un resultado que el BOT ya
// calculó.
//
// IMPORTANTE: ctx.reserva (la salida real de detectarReserva.js, sin
// tocar) NUNCA trae un campo "tipo" — solo trae {ok, reservados, ocupados,
// mensaje, usuario}. Por eso la distinción se hace mirando ctx.reserva vs
// ctx.consulta (igual que ya hace contextBuilder.js) y el campo real
// "resultado.ok", nunca un "resultado.tipo" inexistente:
//   ctx.reserva, ok:true  -> reserva_completa (todo reservado) | reserva_parcial (algo ocupado)
//   ctx.reserva, ok:false -> numero_ocupado (1 solo número pedido) | todos_ocupados (varios)
//   ctx.consulta          -> ya trae su propio "tipo" correcto (resolverConsulta.js)
function calcularTipoPresentacion(ctx, resultado) {

    if (ctx?.reserva) {

        if (resultado?.ok === true) {

            return (resultado.ocupados && resultado.ocupados.length > 0)
                ? "reserva_parcial"
                : "reserva_completa";

        }

        const solicitados = extraerNumeros(ctx.textoOriginal || "", ctx?.evento?.cifras);

        return solicitados.length === 1
            ? "numero_ocupado"
            : "todos_ocupados";

    }

    if (ctx?.consulta) {

        // consulta_pago NUNCA usa una sola plantilla universal: se reparte
        // en 4 categorías según el ESTADO REAL de pago del usuario
        // (resultado.estadoPago, calculado siempre por
        // construirFacetaEstadoNumeros vía determinarEstadoPago() — ver
        // backend/shared/pagos/determinarEstadoPago.js, única fuente de
        // verdad). "multiple" (consulta combinada) NUNCA se reparte así:
        // sigue usando su propio tipo_respuesta="multiple" sin cambios,
        // tal como antes de esta separación.
        if (resultado?.tipo === "consulta_pago" && resultado?.estadoPago) {
            return `consulta_pago_${resultado.estadoPago}`;
        }

        // Resto de tipos de consulta ya usan el nombre correcto
        // (mis_numeros, mis_reservas, cantidad_reservas, numero_especifico,
        // disponibilidad, info_evento, multiple) — puestos por
        // resolverConsulta.js.
        return resultado?.tipo || null;

    }

    return null;

}

module.exports = {
    construirVariables,
    aplicarPlantilla,
    calcularTipoPresentacion,
    MOSTRAR_POR_VARIABLE
};
