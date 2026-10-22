// ==========================================================================
// sorteos/validar.js — validación y normalización PURAS (sin Supabase ni
// WhatsApp) de la configuración de un sorteo creado desde el panel.
//
// La tabla física y la cantidad de números NO se eligen a mano: salen de
// la MISMA configuración que usa el bot al detectar un anuncio
// (bot/funciones/eventos/configEvento.js), así un sorteo manual y uno
// detectado del mismo precio comparten exactamente la misma tabla.
// ==========================================================================

const { obtenerConfiguracion } = require("../bot/funciones/eventos/configEvento");
const { calcularCierre } = require("../bot/funciones/eventos/extractor/calcularCierre");
const { normalizarEleccionDiseno } = require("./disenoTabla");
const { crearIdentidadEventoReal } = require("../bot/funciones/eventos/identidadEventoReal");

const ZONA = "America/Bogota";
const HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIMITES = {
    nombre: 80,
    premios: 20,
    premioTexto: 200,
    grupos: 50,
    cuentas: 10,
    mensaje: 4000,
    recordatorios: 6
};

const TIPOS_PREMIO = new Set(["otro", "bono", "dos_ultimas_cifras", "dos_primeras_cifras", "dos_centro"]);

const MODALIDADES = {
    dos_cifras: { disponible: true },
    tres_cifras_pago: { disponible: false, motivo: "Todavía no existe la tabla de reservas 000-999 ni su configuración de precios." },
    tres_cifras_gratis: { disponible: false, motivo: "Todavía no existe la tabla de reservas 000-999 ni las reglas de participación gratuita." }
};

function partesBogota(fecha) {
    const f = new Intl.DateTimeFormat("en-CA", {
        timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", hourCycle: "h23"
    }).formatToParts(fecha);
    const v = Object.fromEntries(f.map(p => [p.type, p.value]));
    return { fecha: `${v.year}-${v.month}-${v.day}`, hora: `${v.hour}:${v.minute}` };
}

// "YYYY-MM-DD" + "HH:MM[:SS]" en hora de Colombia (UTC-5, sin horario de
// verano) -> Date. Misma función para validar y para el publicador.
function instanteBogota(fecha, hora) {
    if (!fecha || !hora) return null;
    const h = String(hora).length === 5 ? `${hora}:00` : String(hora).slice(0, 8);
    const d = new Date(`${fecha}T${h}-05:00`);
    return Number.isNaN(d.getTime()) ? null : d;
}

// Fecha en que se JUEGA el sorteo. Sorteos anteriores a este campo no la
// traen: se juegan el día de su publicación (comportamiento de siempre).
function fechaSorteoDe(config, publicarEn) {
    if (config?.fecha_sorteo && FECHA.test(config.fecha_sorteo)) return config.fecha_sorteo;
    const d = new Date(publicarEn || config?.publicar_en || "");
    return Number.isNaN(d.getTime()) ? null : partesBogota(d).fecha;
}

// Identidad del sorteo REAL que se programa (la misma que usa el detector).
// Se calcula al guardar y se vuelve a calcular al publicar para comprobar
// que la programación sigue correspondiendo a ese evento.
function identidadDelSorteo(usuarioId, config) {
    return crearIdentidadEventoReal({
        usuario_id: usuarioId,
        nombre_evento: config.nombre,
        hora_fin: config.hora_fin,
        valor: config.valor,
        // La fecha en que se JUEGA (puede ser posterior a la publicación).
        fecha_evento: fechaSorteoDe(config)
    });
}

const aMinutos = (hhmm) => {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
};

function texto(valor, max) {
    if (valor === undefined || valor === null) return "";
    return String(valor).trim().slice(0, max);
}

function idsUnicos(lista, max) {
    if (!Array.isArray(lista)) return [];
    return [...new Set(lista.map(x => String(x || "").trim()).filter(Boolean))].slice(0, max);
}

// Mismo formato que guarda el detector en eventos_bot.premios
// (extractor/extraerPremios.js): { tipo, nombre, premio }. También lo usa la
// edición de un sorteo activo (servicio.editarSorteoActivo).
function normalizarPremios(lista) {
    return (Array.isArray(lista) ? lista : [])
        .map(p => {
            const monto = Number(String(p?.premio ?? "").replace(/[^0-9]/g, ""));
            return {
                tipo: TIPOS_PREMIO.has(p?.tipo) ? p.tipo : "otro",
                nombre: texto(p?.nombre, LIMITES.premioTexto),
                premio: monto > 0 ? monto : null
            };
        })
        .filter(p => p.nombre)
        .slice(0, LIMITES.premios);
}

// validarSorteo(entrada, { ahora }) -> { ok, errores, config, tabla, cifras, cantidad }
function validarSorteo(entrada = {}, { ahora = new Date() } = {}) {

    const errores = [];
    const error = (campo, mensaje) => errores.push({ campo, mensaje });

    const modalidad = entrada.modalidad || "dos_cifras";
    const infoModalidad = MODALIDADES[modalidad];

    if (!infoModalidad) error("modalidad", "Modalidad desconocida.");
    else if (!infoModalidad.disponible) error("modalidad", infoModalidad.motivo);

    const nombre = texto(entrada.nombre, LIMITES.nombre);
    if (!nombre) error("nombre", "Indica la lotería o el nombre del sorteo.");

    // Lotería del calendario (migración 025), opcional: un nombre
    // personalizado no la lleva. Que sea del usuario lo comprueba el servicio.
    const loteriaId = entrada.loteria_id ? String(entrada.loteria_id) : null;
    if (loteriaId && !UUID.test(loteriaId)) error("loteria_id", "Lotería inválida.");

    const horaFin = texto(entrada.hora_fin, 5);
    if (!HORA.test(horaFin)) error("hora_fin", "Hora del sorteo inválida (formato HH:MM, 24 h).");

    let horaCierre = texto(entrada.hora_cierre, 5);
    if (!horaCierre && HORA.test(horaFin)) horaCierre = calcularCierre(horaFin);
    if (horaCierre && !HORA.test(horaCierre)) error("hora_cierre", "Hora de cierre inválida (formato HH:MM, 24 h).");
    if (HORA.test(horaFin) && HORA.test(horaCierre) && aMinutos(horaCierre) > aMinutos(horaFin)) {
        error("hora_cierre", "La hora de cierre no puede ser posterior a la hora del sorteo.");
    }

    const valor = Number(String(entrada.valor ?? "").replace(/[^\d]/g, ""));
    const tablaConfig = valor > 0 ? obtenerConfiguracion(valor) : null;
    if (!valor) error("valor", "Indica el valor por número.");
    else if (!tablaConfig) error("valor", "Ese valor no tiene una tabla de números configurada.");

    const premios = normalizarPremios(entrada.premios);
    if (!premios.length) error("premios", "Agrega al menos un premio.");

    const grupos = idsUnicos(entrada.grupos, LIMITES.grupos);
    if (!grupos.length) error("grupos", "Selecciona al menos un grupo.");
    if (grupos.some(g => !/@g\.us$/.test(g))) error("grupos", "Identificador de grupo inválido.");

    const cuentas = idsUnicos(entrada.cuentas, LIMITES.cuentas);

    const publicarEn = new Date(entrada.publicar_en || "");
    const publicacionValida = !Number.isNaN(publicarEn.getTime());

    // Fecha del sorteo: puede ser posterior a la publicación (p. ej. se
    // anuncia la víspera). Sin ella, el mismo día de la publicación.
    let fechaSorteo = entrada.fecha_sorteo ? texto(entrada.fecha_sorteo, 10) : "";
    if (fechaSorteo && (!FECHA.test(fechaSorteo) || !instanteBogota(fechaSorteo, "00:00"))) {
        error("fecha_sorteo", "Fecha del sorteo inválida.");
        fechaSorteo = "";
    }
    if (!fechaSorteo && publicacionValida) fechaSorteo = partesBogota(publicarEn).fecha;

    if (!publicacionValida) {
        error("publicar_en", "Fecha y hora de publicación inválidas.");
    } else {
        if (publicarEn.getTime() < ahora.getTime() + 60 * 1000) {
            error("publicar_en", "La publicación debe programarse al menos 1 minuto en el futuro.");
        }
        // Se compara el INSTANTE real del cierre (fecha del sorteo + hora de
        // cierre, Colombia): se puede publicar el día anterior o antes, pero
        // nunca después del cierre (el sorteo se cerraría al publicarse).
        const cierre = HORA.test(horaCierre) && fechaSorteo ? instanteBogota(fechaSorteo, horaCierre) : null;
        if (cierre && publicarEn.getTime() >= cierre.getTime()) {
            error("publicar_en", `La publicación debe ser antes del cierre de reservas (${fechaSorteo} ${horaCierre}, hora de Colombia). Adelanta la publicación o cambia la fecha del sorteo.`);
        }
        if (fechaSorteo && fechaSorteo < partesBogota(publicarEn).fecha) {
            error("fecha_sorteo", "La fecha del sorteo no puede ser anterior a la publicación.");
        }
    }

    const mensajes = {
        publicacion: texto(entrada.mensajes?.publicacion, LIMITES.mensaje),
        aviso_cierre: texto(entrada.mensajes?.aviso_cierre, LIMITES.mensaje)
    };

    const recordatorios = (Array.isArray(entrada.recordatorios) ? entrada.recordatorios : [])
        .slice(0, LIMITES.recordatorios)
        .map(r => ({ minutos_antes_cierre: Math.round(Number(r?.minutos_antes_cierre)), texto: texto(r?.texto, LIMITES.mensaje) }));
    recordatorios.forEach((r, i) => {
        if (!(r.minutos_antes_cierre >= 5 && r.minutos_antes_cierre <= 720)) error(`recordatorios[${i}]`, "Los recordatorios van de 5 a 720 minutos antes del cierre.");
        if (!r.texto) error(`recordatorios[${i}]`, "El recordatorio necesita un texto.");
    });
    if (new Set(recordatorios.map(r => r.minutos_antes_cierre)).size !== recordatorios.length) {
        error("recordatorios", "Hay dos recordatorios con los mismos minutos.");
    }

    const liberar = entrada.reservas?.liberar_no_pagados === true;
    const vencimiento = Math.round(Number(entrada.reservas?.vencimiento_minutos ?? 0));
    if (liberar && !(vencimiento >= 10 && vencimiento <= 1440)) {
        error("reservas.vencimiento_minutos", "El vencimiento de las reservas va de 10 a 1440 minutos.");
    }

    const diseno = normalizarEleccionDiseno(entrada.diseno);
    errores.push(...diseno.errores);

    const config = {
        modalidad,
        nombre,
        loteria_id: loteriaId,
        hora_fin: horaFin,
        hora_cierre: horaCierre || null,
        valor,
        premios,
        grupos,
        cuentas,
        publicar_en: publicacionValida ? publicarEn.toISOString() : null,
        fecha_sorteo: fechaSorteo || null,
        // Reinicio de la tabla: SOLO si se elige expresamente (y se confirma
        // en la vista previa). Por defecto se conserva. Nunca se hace al
        // guardar ni al confirmar: el publicador lo hace al publicar.
        // Los bloqueados a mano se conservan; liberarlos exige elegirlo
        // expresamente (y solo tiene sentido si se reinicia).
        tabla: {
            reiniciar: entrada.tabla?.reiniciar === true,
            liberar_bloqueados: entrada.tabla?.reiniciar === true && entrada.tabla?.liberar_bloqueados === true
        },
        diseno: diseno.eleccion,
        mensajes,
        recordatorios: recordatorios.sort((a, b) => b.minutos_antes_cierre - a.minutos_antes_cierre),
        reservas: { liberar_no_pagados: liberar, vencimiento_minutos: liberar ? vencimiento : null }
    };

    return {
        ok: errores.length === 0,
        errores,
        config,
        tabla: tablaConfig?.tabla || null,
        cifras: tablaConfig?.cifras || null,
        cantidad: tablaConfig?.cantidad || null
    };

}

// Plantilla: mismos campos, pero sin grupos obligatorios ni fecha (se eligen
// al usar la plantilla).
function validarPlantilla(entrada = {}) {

    const nombre = texto(entrada.nombre, LIMITES.nombre);
    const errores = [];

    if (!nombre) errores.push({ campo: "nombre", mensaje: "La plantilla necesita un nombre." });

    const base = validarSorteo({
        ...entrada.config,
        grupos: ["plantilla@g.us"],
        publicar_en: new Date(Date.now() + 3600 * 1000).toISOString()
    });

    const ignorar = new Set(["grupos", "publicar_en", "fecha_sorteo"]);
    errores.push(...base.errores.filter(e => !ignorar.has(e.campo)));

    const { grupos, publicar_en, fecha_sorteo, tabla, ...config } = base.config;

    return { ok: errores.length === 0, errores, nombre, config };

}

module.exports = {
    validarSorteo,
    validarPlantilla,
    partesBogota,
    instanteBogota,
    fechaSorteoDe,
    identidadDelSorteo,
    normalizarPremios,
    HORA,
    MODALIDADES
};
