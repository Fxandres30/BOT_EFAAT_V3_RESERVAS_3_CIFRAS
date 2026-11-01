// ==========================================================================
// sorteos/mensajes.js — textos de publicación, recordatorios y aviso de
// cierre de un sorteo programado. PURO: no envía nada.
//
// GENERADOR ÚNICO del mensaje de publicación: lo usan la vista previa del
// formulario (POST /sorteos/mensaje/generar), la vista previa del sorteo,
// el publicador (programado e instantáneo) y «Compartir», así lo que se ve
// es lo que recibe WhatsApp.
//
// El sorteo guarda el TEXTO con {{variables}} (config.mensajes.publicacion)
// y sus metadatos (config.mensajes.publicacion_meta: estilo, activo,
// personalizado, revision, actualizado_en). Las variables se resuelven al
// generar, con los datos reales del sorteo. Un sorteo antiguo sin texto
// guardado ("") usa la plantilla del estilo clásico, como siempre.
// Una variable desconocida NO se borra en silencio: se deja tal cual y se
// avisa; al guardar, el validador la rechaza (validar.js).
// ==========================================================================

const { formatHora12 } = require("../bot/utils/formatHora");
const { ESTILO_PREDETERMINADO, esEstilo, plantillaDe } = require("./estilosMensaje");

// Máximo del mensaje YA GENERADO (mismo límite que «Compartir»).
const LIMITE_MENSAJE = 4000;

// Variables de siempre: también las de recordatorios y aviso de cierre.
const VARIABLES_BASE = {
    nombre: "Lotería o nombre del sorteo",
    hora: "Hora del sorteo (12 h)",
    hora_cierre: "Hora de cierre de reservas (12 h)",
    valor: "Valor por número",
    premios: "Lista de premios",
    cuentas: "Cuentas de pago",
    cantidad: "Cantidad de números",
    fecha: "Fecha del sorteo (AAAA-MM-DD)"
};

// Variables del mensaje de publicación (las de siempre + las de los estilos).
const VARIABLES = {
    ...VARIABLES_BASE,
    nombre_mayusculas: "Nombre del sorteo en mayúsculas",
    fecha_larga: "Fecha del sorteo en palabras (viernes 31 de octubre)",
    fecha_titulo: "Fecha en palabras para inicio de línea (Viernes 31 de octubre)",
    dia_semana: "Día de la semana del sorteo",
    rango: "Rango de números (00 al 99)",
    premio_mayor: "Premio de mayor valor",
    premios_linea: "Premios en una sola línea",
    premios_numerados: "Premios en lista numerada",
    premios_texto: "Premios sin emojis",
    premios_guias: "Premios con puntos guía (para bloques monoespaciados)",
    cuentas_compacto: "Cuentas de pago en una sola línea"
};

// Compatibilidad: la plantilla de siempre es la del estilo clásico.
const PLANTILLA_PUBLICACION = plantillaDe(ESTILO_PREDETERMINADO);

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

const conMonto = (p, sep) => `${p.nombre}${p.premio ? `${sep}${pesos(p.premio)}` : ""}`;

function premioMayor(premios) {
    if (!premios.length) return "";
    const mayor = premios.reduce((a, p) => (Number(p.premio) || 0) > (Number(a.premio) || 0) ? p : a, premios[0]);
    return conMonto(mayor, " de ");
}

// "Premio mayor ........ $1.000.000" (ancho fijo para bloques monoespaciados).
function premiosGuias(premios) {
    const ancho = 24;
    return premios.map(p => {
        if (!p.premio) return p.nombre;
        const puntos = ".".repeat(Math.max(3, ancho - p.nombre.length));
        return `${p.nombre} ${puntos} ${pesos(p.premio)}`;
    }).join("\n");
}

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

// "AAAA-MM-DD" (fecha del sorteo, Colombia) -> partes en palabras. Se calcula
// sobre la fecha tal cual (UTC al mediodía): no depende del huso del servidor.
function fechaEnPalabras(fecha) {
    const m = String(fecha || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return { larga: "", dia: "" };
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
    if (Number.isNaN(d.getTime())) return { larga: "", dia: "" };
    const dia = DIAS[d.getUTCDay()];
    return { larga: `${dia} ${d.getUTCDate()} de ${MESES[d.getUTCMonth()]}`, dia };
}

// 100 -> "00 al 99"; 1000 -> "000 al 999".
function rangoDe(cantidad) {
    const n = Number(cantidad);
    if (!Number.isInteger(n) || n < 2) return "";
    const cifras = String(n - 1).length;
    return `${"0".repeat(cifras)} al ${n - 1}`;
}

function valoresBase(config, cuentas, { fecha } = {}) {
    return {
        nombre: config.nombre,
        hora: config.hora_fin ? formatHora12(config.hora_fin) : "",
        hora_cierre: config.hora_cierre ? formatHora12(config.hora_cierre) : "",
        valor: pesos(config.valor),
        premios: (config.premios || []).map(p => `🍀 ${conMonto(p, ": ")}`).join("\n"),
        cuentas: listaCuentas(cuentas),
        cantidad: String(config.cantidad_numeros || ""),
        fecha: fecha || ""
    };
}

function valoresDe(config, cuentas, opciones = {}) {
    const premios = (config.premios || []).filter(p => p?.nombre);
    const fecha = fechaEnPalabras(opciones.fecha);
    return {
        ...valoresBase(config, cuentas, opciones),
        nombre_mayusculas: String(config.nombre || "").toLocaleUpperCase("es-CO"),
        fecha_larga: fecha.larga,
        fecha_titulo: fecha.larga.charAt(0).toLocaleUpperCase("es-CO") + fecha.larga.slice(1),
        dia_semana: fecha.dia,
        rango: rangoDe(config.cantidad_numeros),
        premio_mayor: premioMayor(premios),
        premios_linea: premios.map(p => conMonto(p, " ")).join(" · "),
        premios_numerados: premios.map((p, i) => `${i + 1}. ${conMonto(p, ": ")}`).join("\n"),
        premios_texto: premios.map(p => conMonto(p, " — ")).join("\n"),
        premios_guias: premiosGuias(premios),
        cuentas_compacto: cuentas?.length ? cuentas.map(c => `${c.nombre} ${c.numero}`).join(" · ") : "(sin cuentas de pago configuradas)"
    };
}

const VARIABLE = /\{\{\s*([a-z_]+)\s*\}\}/gi;

// Marco o sangría antes de una variable de varias líneas ("│ ", "> ", "   "):
// se repite en cada línea del valor para que la lista quede dentro.
const MARCO = /^[ \t]*(?:[│┃║>][ \t]*)?$/;

// Sustituye {{variable}}. Devuelve el texto y las variables desconocidas.
// `marcos`: solo en los textos del sistema de estilos (los antiguos se
// generan exactamente como antes).
function aplicar(plantilla, valores, { marcos = false } = {}) {

    const desconocidas = new Set();

    const texto = String(plantilla || "").replace(VARIABLE, (completo, nombre, posicion, todo) => {
        const clave = nombre.toLowerCase();
        if (!Object.prototype.hasOwnProperty.call(valores, clave)) {
            desconocidas.add(nombre);
            return completo;
        }
        const valor = String(valores[clave] ?? "");
        if (!marcos || !valor.includes("\n")) return valor;
        const prefijo = todo.slice(todo.lastIndexOf("\n", posicion - 1) + 1, posicion);
        return prefijo && MARCO.test(prefijo) ? valor.split("\n").join(`\n${prefijo}`) : valor;
    });

    return { texto, desconocidas: [...desconocidas] };

}

// Variables de `texto` que el mensaje de publicación no conoce.
function variablesDesconocidas(texto) {
    const fuera = new Set();
    for (const m of String(texto || "").matchAll(VARIABLE)) {
        if (!Object.prototype.hasOwnProperty.call(VARIABLES, m[1].toLowerCase())) fuera.add(m[1]);
    }
    return [...fuera];
}

// ---------------------------------------------------------------- estado ---

// Metadatos del mensaje guardado en el sorteo. Sin ellos (sorteo antiguo):
// estilo clásico, activo, revisión 0. `personalizado` se calcula siempre
// comparando con la plantilla del estilo (no se confía en lo guardado).
function metaPublicacion(mensajes) {
    const m = mensajes?.publicacion_meta;
    const estilo = esEstilo(m?.estilo) ? m.estilo : ESTILO_PREDETERMINADO;
    const texto = mensajes?.publicacion || plantillaDe(estilo);
    return {
        estilo,
        activo: m?.activo !== false,
        personalizado: texto !== plantillaDe(estilo),
        revision: Number.isInteger(m?.revision) ? m.revision : 0,
        actualizado_en: typeof m?.actualizado_en === "string" ? m.actualizado_en : null
    };
}

// Texto (con variables) que se publica: el guardado o, si no hay (sorteo
// antiguo o texto eliminado), la plantilla de su estilo.
function textoPublicacion(mensajes) {
    return mensajes?.publicacion || plantillaDe(metaPublicacion(mensajes).estilo);
}

// Mensajes que se guardan en el sorteo a partir de lo enviado por el panel
// (`nuevos`, ya validado) y lo que el sorteo tenía (`anteriores`, null al
// crear). Nunca se pierde el texto: vacío = plantilla del estilo, guardada
// como texto. La revisión solo sube si el texto cambia; los metadatos que
// el panel no envía (p. ej. un panel antiguo) se conservan.
function consolidarMensajes(nuevos = {}, anteriores = null, { ahora = new Date(), estiloPorDefecto = null } = {}) {

    const previo = anteriores ? metaPublicacion(anteriores) : null;
    const pedido = nuevos.publicacion_meta || {};

    const estilo = esEstilo(pedido.estilo) ? pedido.estilo
        : previo ? previo.estilo
            : esEstilo(estiloPorDefecto) ? estiloPorDefecto : ESTILO_PREDETERMINADO;
    const activo = typeof pedido.activo === "boolean" ? pedido.activo : previo ? previo.activo : true;
    const publicacion = nuevos.publicacion || plantillaDe(estilo);

    const cambiaTexto = !anteriores || textoPublicacion(anteriores) !== publicacion;
    const cambia = cambiaTexto || !anteriores?.publicacion_meta || previo.estilo !== estilo || previo.activo !== activo;
    const revisionPrevia = Math.max(previo?.revision || 0, 1);

    const { publicacion_meta: metaNueva, ...resto } = nuevos;

    return {
        ...(anteriores || {}),
        ...resto,
        publicacion,
        publicacion_meta: {
            ...(anteriores?.publicacion_meta || {}),
            estilo,
            activo,
            personalizado: publicacion !== plantillaDe(estilo),
            revision: !anteriores ? 1 : cambiaTexto ? revisionPrevia + 1 : revisionPrevia,
            actualizado_en: cambia || !previo?.actualizado_en ? ahora.toISOString() : previo.actualizado_en
        }
    };

}

// ------------------------------------------------------------- generador ---

// Genera un texto (con variables) con los datos de un sorteo.
// -> { texto, desconocidas, longitud, excede }
function generar(plantilla, config, cuentas, { fecha, marcos = true } = {}) {
    const r = aplicar(plantilla, valoresDe(config, cuentas || [], { fecha }), { marcos });
    return { ...r, longitud: r.texto.length, excede: r.texto.length > LIMITE_MENSAJE };
}

// Mensaje de publicación de un sorteo (config.mensajes). `activo`: si el
// texto debe acompañar a la imagen; inactivo se publica solo la imagen.
function mensajePublicacion(config, cuentas, opciones = {}) {
    const meta = metaPublicacion(config.mensajes);
    const legado = !config.mensajes?.publicacion_meta;
    const r = generar(textoPublicacion(config.mensajes), config, cuentas, { fecha: opciones.fecha, marcos: !legado });
    return { ...r, activo: meta.activo, estilo: meta.estilo };
}

// Anuncio de un sorteo programado a partir de SU fila de eventos_bot: el
// MISMO texto para la publicación automática (publicador.js) y para el
// botón «Compartir» (destinosCompartir.textoParaCompartir). publicacion: el
// texto guardado en el sorteo (vacío = plantilla de su estilo); meta: sus
// metadatos (estilo, activo).
function anuncioDelEvento(evento, { publicacion = "", cuentas = [], meta = null } = {}) {
    const config = {
        nombre: evento.nombre_evento,
        hora_fin: evento.hora_fin,
        hora_cierre: evento.hora_cierre,
        valor: evento.valor,
        premios: Array.isArray(evento.premios) ? evento.premios : [],
        cantidad_numeros: evento.cantidad_numeros,
        mensajes: { publicacion, ...(meta ? { publicacion_meta: meta } : {}) }
    };
    const fecha = evento.fecha_evento ? String(evento.fecha_evento).slice(0, 10) : "";
    return mensajePublicacion(config, cuentas || [], { fecha });
}

// Recordatorios y aviso de cierre: sistema independiente, sin cambios (solo
// las variables de siempre).
function mensajeRecordatorio(config, recordatorio, cuentas, opciones) {
    return aplicar(recordatorio.texto, valoresBase(config, cuentas, opciones));
}

function mensajeAvisoCierre(config, cuentas, opciones) {
    return aplicar(config.mensajes?.aviso_cierre || PLANTILLA_CIERRE, valoresBase(config, cuentas, opciones));
}

module.exports = {
    VARIABLES,
    VARIABLES_BASE,
    LIMITE_MENSAJE,
    PLANTILLA_PUBLICACION,
    PLANTILLA_CIERRE,
    generar,
    metaPublicacion,
    textoPublicacion,
    consolidarMensajes,
    variablesDesconocidas,
    mensajePublicacion,
    anuncioDelEvento,
    mensajeRecordatorio,
    mensajeAvisoCierre
};
