// ==========================================================================
// sorteos/mensajes.js — textos de publicación, recordatorios y aviso de
// cierre de un sorteo programado. PURO: no envía nada.
//
// El administrador escribe su propio texto con estas variables; si deja el
// mensaje vacío se usa una plantilla por defecto. Una variable desconocida
// NO se borra en silencio: se deja tal cual y se avisa en la vista previa.
// ==========================================================================

const { formatHora12 } = require("../bot/utils/formatHora");

const VARIABLES = {
    nombre: "Lotería o nombre del sorteo",
    hora: "Hora del sorteo (12 h)",
    hora_cierre: "Hora de cierre de reservas (12 h)",
    valor: "Valor por número",
    premios: "Lista de premios",
    cuentas: "Cuentas de pago",
    cantidad: "Cantidad de números",
    fecha: "Fecha de publicación"
};

const PLANTILLA_PUBLICACION = [
    "🎉 *{{nombre}}* 🎉",
    "🕘 Juega a las {{hora}}",
    "💵 Valor del número: {{valor}}",
    "",
    "🏆 *Premios*",
    "{{premios}}",
    "",
    "💳 *Pagos*",
    "{{cuentas}}",
    "",
    "✍️ Escribe el número que quieres para reservarlo. Reservas hasta las {{hora_cierre}}."
].join("\n");

const PLANTILLA_CIERRE = "🔒 *{{nombre}}* — reservas cerradas. ¡Gracias por participar!";

function pesos(valor) {
    return `$${Number(valor || 0).toLocaleString("es-CO")}`;
}

function listaCuentas(cuentas) {
    if (!cuentas?.length) return "(sin cuentas de pago configuradas)";
    return cuentas
        .map(c => `• ${c.nombre}: ${c.numero}${c.titular ? ` (${c.titular})` : ""}${c.instrucciones ? ` — ${c.instrucciones}` : ""}`)
        .join("\n");
}

function valoresDe(config, cuentas, { fecha } = {}) {
    return {
        nombre: config.nombre,
        hora: config.hora_fin ? formatHora12(config.hora_fin) : "",
        hora_cierre: config.hora_cierre ? formatHora12(config.hora_cierre) : "",
        valor: pesos(config.valor),
        premios: (config.premios || []).map(p => `🍀 ${p.nombre}${p.premio ? `: ${pesos(p.premio)}` : ""}`).join("\n"),
        cuentas: listaCuentas(cuentas),
        cantidad: String(config.cantidad_numeros || ""),
        fecha: fecha || ""
    };
}

// Sustituye {{variable}}. Devuelve el texto y las variables desconocidas.
function aplicar(plantilla, valores) {

    const desconocidas = new Set();

    const texto = String(plantilla || "").replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (completo, nombre) => {
        const clave = nombre.toLowerCase();
        if (Object.prototype.hasOwnProperty.call(valores, clave)) return valores[clave];
        desconocidas.add(nombre);
        return completo;
    });

    return { texto, desconocidas: [...desconocidas] };

}

function mensajePublicacion(config, cuentas, opciones) {
    return aplicar(config.mensajes?.publicacion || PLANTILLA_PUBLICACION, valoresDe(config, cuentas, opciones));
}

// Anuncio de un sorteo programado a partir de SU fila de eventos_bot: el
// MISMO texto para la publicación automática (publicador.js) y para el
// botón «Compartir» (destinosCompartir.textoParaCompartir). publicacion: el
// texto guardado en el sorteo (vacío = plantilla por defecto).
function anuncioDelEvento(evento, { publicacion = "", cuentas = [] } = {}) {
    const config = {
        nombre: evento.nombre_evento,
        hora_fin: evento.hora_fin,
        hora_cierre: evento.hora_cierre,
        valor: evento.valor,
        premios: Array.isArray(evento.premios) ? evento.premios : [],
        cantidad_numeros: evento.cantidad_numeros,
        mensajes: { publicacion }
    };
    const fecha = evento.fecha_evento ? String(evento.fecha_evento).slice(0, 10) : "";
    return mensajePublicacion(config, cuentas || [], { fecha });
}

function mensajeRecordatorio(config, recordatorio, cuentas, opciones) {
    return aplicar(recordatorio.texto, valoresDe(config, cuentas, opciones));
}

function mensajeAvisoCierre(config, cuentas, opciones) {
    return aplicar(config.mensajes?.aviso_cierre || PLANTILLA_CIERRE, valoresDe(config, cuentas, opciones));
}

module.exports = {
    VARIABLES,
    PLANTILLA_PUBLICACION,
    PLANTILLA_CIERRE,
    mensajePublicacion,
    anuncioDelEvento,
    mensajeRecordatorio,
    mensajeAvisoCierre
};
