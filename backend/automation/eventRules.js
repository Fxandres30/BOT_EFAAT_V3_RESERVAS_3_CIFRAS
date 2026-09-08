// ==========================================================================
// eventRules.js — funciones PURAS de identidad y decisión.
//
// Nada en este archivo toca Supabase, WhatsApp, ni ningún efecto lateral.
// Recibe datos ya resueltos por el llamador (engine.js) y devuelve una
// decisión. Repository = persistencia. Engine = orquestación.
// Rules (este archivo) = decisiones — ver Master Spec §7/§13 y
// PHASE_2A_FINDINGS §5-6.
// ==========================================================================

const crypto = require("crypto");

// Días de la semana, en el mismo orden que devuelve Intl con weekday:"long"
// en inglés — se traduce a español sin depender de la localización del
// entorno (evita sorpresas de acentos/capitalización entre sistemas).
const DIAS_EN_A_ES = {
    Monday: "lunes",
    Tuesday: "martes",
    Wednesday: "miercoles",
    Thursday: "jueves",
    Friday: "viernes",
    Saturday: "sabado",
    Sunday: "domingo"
};

const ZONA_HORARIA = "America/Bogota";

// ==========================================================================
// IDENTIDAD DE CICLO
// ==========================================================================
//
// Confirmada en Fase 2A (PHASE_2A_FINDINGS §6): estos 5 campos existen con
// estos nombres exactos en la fila real que devuelve detectarEvento() (=
// eventos_bot). NO cambiar estos nombres sin volver a verificar contra el
// código real de guardarEvento.js.
//
// evento.grupo_id
// evento.nombre_evento
// evento.hora_fin        (la HORA DEL SORTEO, pese al nombre de la columna)
// evento.valor
// evento.fecha_evento    (fecha calculada por guardarEvento() al guardar,
//                          no extraída del texto — PHASE_2A_FINDINGS §6)
//
// Determinística: mismos datos -> mismo hash, siempre. No genera nada
// aleatorio, no consulta nada, no muta `evento`.
function crearIdentidadCiclo(evento) {

    if (!evento || typeof evento !== "object") {
        throw new Error("crearIdentidadCiclo: se requiere un objeto evento");
    }

    const partes = [
        evento.grupo_id,
        evento.nombre_evento,
        evento.hora_fin,
        evento.valor,
        evento.fecha_evento
    ].map(valor => (valor === undefined || valor === null) ? "" : String(valor));

    return crypto
        .createHash("sha256")
        .update(partes.join("|"))
        .digest("hex");

}

// ==========================================================================
// EVALUAR APERTURA
// ==========================================================================
//
// Función pura: NO abre grupos, NO envía mensajes, NO reserva números, NO
// modifica eventos, NO toca Supabase. Solo decide, a partir de datos que el
// llamador ya resolvió (engine.js es quien consulta Supabase antes de
// llamar aquí).
//
// Devuelve siempre { permitido: boolean, motivo: string|null }.
function evaluarApertura({
    evento,
    configuracion,
    grupoAutorizado,
    eventSessionExistente = null,
    ahora = new Date()
} = {}) {

    // 1. Grupo autorizado.
    if (!grupoAutorizado) {

        return { permitido: false, motivo: "grupo_no_autorizado" };

    }

    // 2. Configuración activa. Cubre tanto "no existe configuración todavía"
    //    como "existe pero el interruptor maestro está apagado" — el efecto
    //    práctico es idéntico (sin automatización), así que se reporta con
    //    el mismo motivo; ver docs/EFAAT_AUTOMATION_PHASE_2B_IMPLEMENTATION.md.
    if (!configuracion || configuracion.activo !== true) {

        return { permitido: false, motivo: "configuracion_inactiva" };

    }

    // 3. Día permitido (según la configuración, no una regla universal).
    const claveDia = obtenerClaveDia(ahora);
    const configDia = configuracion.dias_permitidos
        ? configuracion.dias_permitidos[claveDia]
        : null;

    if (!configDia || configDia.activo !== true) {

        return { permitido: false, motivo: "dia_no_permitido" };

    }

    // 4. Horario permitido ESE día (rango "desde"/"hasta" de la
    //    configuración — nunca la hora del sorteo).
    if (!dentroDeHorarioPermitido(ahora, configDia)) {

        return { permitido: false, motivo: "horario_no_permitido" };

    }

    // 5. Evento válido — defensivo: detectarEvento()/extraerEvento() ya
    //    garantizan esto antes de guardar, no se recalcula nada, solo se
    //    revalida que los campos de identidad mínimos existan.
    if (!evento || !evento.nombre_evento || !evento.hora_fin || !evento.valor) {

        return { permitido: false, motivo: "evento_invalido" };

    }

    // 6. Ciclo no duplicado. Cualquier event_sessions ya existente para
    //    (grupo_id, identidad_ciclo) — en CUALQUIER estado — significa que
    //    este ciclo ya se procesó antes; la propia restricción UNIQUE de la
    //    tabla ya lo garantiza a nivel de base de datos, esto es la
    //    verificación de negocio antes de intentar el INSERT.
    if (eventSessionExistente) {

        return { permitido: false, motivo: "ciclo_duplicado" };

    }

    return { permitido: true, motivo: null };

}

// Nombre de día en español (lunes..domingo), calculado sobre la zona
// horaria del negocio (America/Bogota), sin depender de la configuración
// regional del proceso Node donde corra el backend.
function obtenerClaveDia(fecha) {

    const nombreIngles = new Intl.DateTimeFormat("en-US", {
        timeZone: ZONA_HORARIA,
        weekday: "long"
    }).format(fecha);

    return DIAS_EN_A_ES[nombreIngles] || null;

}

// "HH:mm" en America/Bogota para la fecha dada.
function obtenerHoraMinuto(fecha) {

    return new Intl.DateTimeFormat("en-GB", {
        timeZone: ZONA_HORARIA,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
    }).format(fecha);

}

// configDia = { activo, desde: "HH:mm", hasta: "HH:mm" }. Comparación
// lexicográfica de strings "HH:mm" con cero-relleno es válida como
// comparación horaria dentro del mismo día.
function dentroDeHorarioPermitido(ahora, configDia) {

    if (!configDia.desde || !configDia.hasta) {
        return false;
    }

    const horaActual = obtenerHoraMinuto(ahora);

    return horaActual >= configDia.desde && horaActual <= configDia.hasta;

}

// Minutos desde "HH:mm" (horaInicio) hasta "HH:mm" (horaFin), asumiendo
// mismo día (misma simplificación que ya usa verificarHoraCierre.js del
// bot: un sorteo no cruza medianoche). Devuelve null si algún valor no
// tiene forma "HH:mm" — el llamador decide qué hacer ante eso (nunca se
// inventa una hora).
function minutosEntre(horaInicio, horaFin) {

    const parsear = (hhmm) => {
        if (typeof hhmm !== "string") return null;
        const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
        if (!m) return null;
        const horas = Number(m[1]);
        const minutos = Number(m[2]);
        if (!Number.isFinite(horas) || !Number.isFinite(minutos)) return null;
        return horas * 60 + minutos;
    };

    const inicio = parsear(horaInicio);
    const fin = parsear(horaFin);

    if (inicio === null || fin === null) return null;

    return fin - inicio;

}

module.exports = {
    crearIdentidadCiclo,
    evaluarApertura,
    obtenerClaveDia,
    obtenerHoraMinuto,
    minutosEntre
};
