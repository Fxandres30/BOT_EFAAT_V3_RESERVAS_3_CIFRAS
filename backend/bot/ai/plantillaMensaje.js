// Variables reales disponibles para plantillas de mensajes (Fase 5.2).
// Nunca inventa datos: si un dato no existe para ese tipo de resultado,
// la variable queda vacía (nunca se rellena con un valor inventado).
const { construirVariablesGramaticales, construirVariablesPorConjunto, calcularNumerosRelevantes, formatearListaNumeros } = require("./gramatica");
const { extraerNumeros } = require("../funciones/reservas/extraerNumeros");

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

    // NO existe "total": no hay lógica de pagos/montos totales en el
    // sistema actual (ver auditoría Fase 4). No se ofrece esa variable
    // para no sugerir una funcionalidad que no existe.

};

function construirVariables(ctx, resultado) {

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

    return {

        cliente: ctx.usuario?.nombre || "",
        evento: ctx.evento?.nombre_evento || "",
        numeros_solicitados: formatearListaNumeros(numerosSolicitados),
        numeros_reservados: formatearListaNumeros(numerosReservados),
        numeros_ocupados: formatearListaNumeros(numerosOcupados),
        numeros_disponibles: formatearListaNumeros(numerosDisponibles),
        fecha: ctx.evento?.fecha_evento || "",
        hora: ctx.evento?.hora_fin || "",
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

// Sustituye {{variable}} por su valor real. "opcionesMostrar" es el objeto
// JSONB de la columna plantillas_mensaje.variables (Fase 5.3): si su
// mostrar_* correspondiente es false, se reemplaza por cadena vacía
// (nunca se deja "{{...}}" literal ni se inventa un valor).
function aplicarPlantilla(plantilla, variables, opcionesMostrar = {}) {

    if (typeof plantilla !== "string" || !plantilla.trim()) {
        return null;
    }

    return plantilla.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, nombre) => {

        const campoMostrar = MOSTRAR_POR_VARIABLE[nombre];

        if (campoMostrar && opcionesMostrar[campoMostrar] === false) {
            return "";
        }

        const valor = variables[nombre];

        return valor !== undefined && valor !== null ? valor : "";

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

        const solicitados = extraerNumeros(ctx.textoOriginal || "");

        return solicitados.length === 1
            ? "numero_ocupado"
            : "todos_ocupados";

    }

    if (ctx?.consulta) {

        // Tipos de consulta ya usan el nombre correcto (mis_numeros,
        // mis_reservas, cantidad_reservas, numero_especifico,
        // disponibilidad, info_evento) — puestos por resolverConsulta.js.
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
