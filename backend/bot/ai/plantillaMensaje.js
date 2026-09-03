// Variables reales disponibles para plantillas de mensajes (Fase 5.2).
// Nunca inventa datos: si un dato no existe para ese tipo de resultado,
// la variable queda vacía (nunca se rellena con un valor inventado).
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

    // Igual que calcularTipoPresentacion: ctx.reserva nunca trae
    // "resultado.tipo" (ver detectarReserva.js), así que se distingue por
    // la presencia de ctx.reserva/ctx.consulta, no por ese campo.
    const tipo = ctx?.reserva ? null : (resultado?.tipo || null);

    let numerosSolicitados = [];
    let numerosReservados = [];
    let numerosOcupados = [];
    let numerosDisponibles = [];

    if (ctx?.reserva) {

        numerosSolicitados = extraerNumeros(ctx.textoOriginal || "");
        numerosReservados = resultado.reservados || [];
        numerosOcupados = resultado.ocupados || [];

    } else if (tipo === "mis_numeros" || tipo === "mis_reservas") {

        numerosReservados = resultado.numerosDelUsuario || [];

    } else if (tipo === "numero_especifico") {

        numerosSolicitados = resultado.numero ? [resultado.numero] : [];

    } else if (tipo === "disponibilidad") {

        numerosDisponibles = resultado.numerosDisponibles || [];
        numerosOcupados = resultado.numerosOcupados || [];

    }

    return {

        cliente: ctx.usuario?.nombre || "",
        evento: ctx.evento?.nombre_evento || "",
        numeros_solicitados: numerosSolicitados.join(", "),
        numeros_reservados: numerosReservados.join(", "),
        numeros_ocupados: numerosOcupados.join(", "),
        numeros_disponibles: numerosDisponibles.join(", "),
        fecha: ctx.evento?.fecha_evento || "",
        hora: ctx.evento?.hora_fin || "",
        // "precio" es el valor por número del evento (dato real, eventos_bot.valor).
        precio: ctx.evento?.valor != null ? String(ctx.evento.valor) : "",
        cantidad: resultado?.cantidad != null ? String(resultado.cantidad) : ""

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
