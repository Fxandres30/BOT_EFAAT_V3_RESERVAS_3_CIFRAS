// ==========================================================================
// estadoProgramacion.ts — cálculo PURO (sin red ni Supabase) del estado de
// los recordatorios que muestra Automatización → Programación.
//
// Todo sale de registros reales; nada se simula:
//   - cierre real        eventos_bot.fecha_evento + hora_cierre (la misma
//                        hora que usa el Scheduler: snapshot del ciclo
//                        primero, eventos_bot después), en hora de Colombia;
//   - recordatorios      automation_configs.recordatorios;
//   - envíos             automation_actions, con la MISMA clave de
//                        idempotencia que escribe backend/automation/
//                        scheduler.js::evaluarRecordatorios:
//                        "<event_session.id>:REMINDER_<offset>M".
//
// "Enviado" significa que WhatsApp aceptó el mensaje (automation_actions
// estado "ok"). El sistema no registra entregas ni lecturas, así que nunca
// se afirma que el mensaje llegó.
// ==========================================================================

// Colombia no tiene horario de verano: el desfase es fijo.
const DESFASE_COLOMBIA = "-05:00";

// Ventanas de presentación (no cambian ninguna decisión del backend).
export const PROXIMO_MS = 5 * 60 * 1000;          // «Próximo a enviarse»
export const GRACIA_TICK_MS = 2 * 60 * 1000;       // el Scheduler revisa cada 30 s
export const EN_CURSO_ESTANCADO_MS = 5 * 60 * 1000; // mismo umbral que executionGuard.obtenerAccionesEstancadas
export const DATOS_VIEJOS_MS = 3 * 60 * 1000;

export type EstadoRecordatorio =
    | "desactivado"
    | "sin_evento"
    | "sin_hora"
    | "programado"
    | "proximo"
    | "pendiente"
    | "sin_registro"
    | "enviando"
    | "sin_confirmar"
    | "enviado"
    | "omitido"
    | "error"
    | "no_enviado";

export interface AccionRegistrada {
    id: string;
    event_session_id: string | null;
    tipo_accion: string;
    clave_idempotencia?: string;
    estado: "en_progreso" | "ok" | "error" | string;
    ejecutado_en: string | null;
    finalizado_en: string | null;
    detalle: Record<string, unknown> | null;
}

export interface ResultadoRecordatorio {
    offset: number;
    estado: EstadoRecordatorio;
    etiqueta: string;
    // Explicación sencilla para el cliente (sin términos técnicos).
    motivo: string | null;
    // Texto original del registro, solo para la sección de diagnóstico.
    detalleTecnico: string | null;
    momento: Date | null;    // cierre - offset
    restanteMs: number | null; // solo si el envío aún está por llegar
    registradoEn: Date | null; // finalizado_en (o ejecutado_en) del registro
}

// -------------------------------------------------------------- tiempo ---

export function fechaValida(valor: string | null | undefined): Date | null {

    if (!valor) return null;

    const fecha = new Date(valor);

    return Number.isNaN(fecha.getTime()) ? null : fecha;

}

// fecha "YYYY-MM-DD" (día operativo de Colombia, ver
// backend/bot/funciones/eventos/identidadEventoReal.js::fechaEventoHoy) +
// hora "HH:mm" -> instante real. Sin fecha válida NO se adivina el día:
// devuelve null y la vista no muestra cuenta regresiva.
export function calcularCierreReal(fechaEvento: string | null | undefined, horaCierre: string | null | undefined): Date | null {

    if (!fechaEvento || !horaCierre) return null;

    const dia = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(fechaEvento).trim());
    const hora = /^(\d{1,2}):(\d{2})$/.exec(String(horaCierre).trim());

    if (!dia || !hora) return null;

    const h = Number(hora[1]);
    const m = Number(hora[2]);

    if (h > 23 || m > 59) return null;

    const instante = new Date(`${dia[1]}-${dia[2]}-${dia[3]}T${String(h).padStart(2, "0")}:${hora[2]}:00${DESFASE_COLOMBIA}`);

    return Number.isNaN(instante.getTime()) ? null : instante;

}

// "2 h 05 min", "12 min 30 s", "45 s". Nunca negativo.
export function formatearRestante(ms: number): string {

    const total = Math.max(0, Math.floor(ms / 1000));

    const dias = Math.floor(total / 86400);
    const horas = Math.floor((total % 86400) / 3600);
    const minutos = Math.floor((total % 3600) / 60);
    const segundos = total % 60;

    if (dias > 0) return `${dias} d ${horas} h`;
    if (horas > 0) return `${horas} h ${String(minutos).padStart(2, "0")} min`;
    if (minutos > 0) return `${minutos} min ${String(segundos).padStart(2, "0")} s`;

    return `${segundos} s`;

}

const FORMATO_DIA = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" });
const FORMATO_HORA = new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", hour: "numeric", minute: "2-digit", hour12: true });

// "hoy 2:56 p. m." / "mañana 9:00 a. m." / "23/10 2:56 p. m." en hora de Colombia.
export function formatearMomento(fecha: Date, ahora: Date): string {

    const dia = FORMATO_DIA.format(fecha);
    const hoy = FORMATO_DIA.format(ahora);
    const manana = FORMATO_DIA.format(new Date(ahora.getTime() + 86400000));
    const ayer = FORMATO_DIA.format(new Date(ahora.getTime() - 86400000));

    const hora = FORMATO_HORA.format(fecha);

    if (dia === hoy) return `hoy ${hora}`;
    if (dia === manana) return `mañana ${hora}`;
    if (dia === ayer) return `ayer ${hora}`;

    const [, mes, d] = dia.split("-");

    return `${d}/${mes} ${hora}`;

}

// "hace 3 min" / "hace 2 h" — para la hora del último envío.
export function formatearHace(fecha: Date, ahora: Date): string {

    const ms = ahora.getTime() - fecha.getTime();

    if (ms < 60000) return "hace un momento";

    return `hace ${formatearRestante(ms).replace(/ \d+ s$/, "")}`;

}

// --------------------------------------------------------- recordatorios ---

// Misma clave que scheduler.js (Number(offsetTexto) -> "REMINDER_60M").
export function claveRecordatorio(eventSessionId: string, offset: number): string {

    return `${eventSessionId}:REMINDER_${offset}M`;

}

const ETIQUETAS: Record<EstadoRecordatorio, string> = {
    desactivado: "Desactivado",
    sin_evento: "No programado",
    sin_hora: "Sin hora de cierre",
    programado: "Programado",
    proximo: "Próximo a enviarse",
    pendiente: "Enviándose ahora",
    sin_registro: "Sin registro de envío",
    enviando: "Enviándose",
    sin_confirmar: "Sin confirmar",
    enviado: "Enviado",
    omitido: "Omitido",
    error: "Error",
    no_enviado: "No enviado"
};

// Motivos de omisión que escribe eventRules.decidirRecordatoriosSegunEstado
// (detalle.resultado.motivo). Uno desconocido se muestra genérico.
const MOTIVOS_OMISION: Record<string, string> = {
    grupo_cerrado: "el grupo ya estaba cerrado",
    sin_disponibles: "no quedaban números libres",
    sin_disponibles_ni_pendientes: "no quedaban números libres ni pagos pendientes"
};

function motivoOmision(codigo: unknown): string {

    if (typeof codigo === "string" && MOTIVOS_OMISION[codigo]) {
        return `No se envió porque ${MOTIVOS_OMISION[codigo]}.`;
    }

    return "No se envió porque el estado del sorteo no lo permitía.";

}

function textoDetalle(detalle: Record<string, unknown> | null): string | null {

    if (!detalle) return null;

    if (typeof detalle.mensaje === "string") return detalle.mensaje;

    const resultado = detalle.resultado as Record<string, unknown> | null | undefined;

    if (resultado && typeof resultado.motivo === "string") return resultado.motivo;

    return null;

}

export interface EntradaRecordatorio {
    offset: number;
    activo: boolean;
    cierre: Date | null;
    // Hay un ciclo de automatización abierto para el evento.
    cicloAbierto: boolean;
    // Registro de automation_actions con la clave de este recordatorio.
    accion: AccionRegistrada | null;
    ahora: Date;
}

export function estadoRecordatorio({ offset, activo, cierre, cicloAbierto, accion, ahora }: EntradaRecordatorio): ResultadoRecordatorio {

    const base = (estado: EstadoRecordatorio, extra: Partial<ResultadoRecordatorio> = {}): ResultadoRecordatorio => ({
        offset,
        estado,
        etiqueta: ETIQUETAS[estado],
        motivo: null,
        detalleTecnico: null,
        momento: cierre ? new Date(cierre.getTime() - offset * 60000) : null,
        restanteMs: null,
        registradoEn: null,
        ...extra
    });

    // 1. Lo que el sistema registró manda sobre cualquier cálculo.
    if (accion) {

        const registradoEn = fechaValida(accion.finalizado_en) || fechaValida(accion.ejecutado_en);
        const detalleTecnico = textoDetalle(accion.detalle);

        if (accion.estado === "ok") {

            const resultado = (accion.detalle?.resultado ?? null) as Record<string, unknown> | null;

            if (resultado && resultado.omitido === true) {
                return base("omitido", { registradoEn, detalleTecnico, motivo: motivoOmision(resultado.motivo) });
            }

            return base("enviado", {
                registradoEn,
                motivo: "WhatsApp aceptó el mensaje. El sistema no confirma la entrega ni la lectura."
            });

        }

        if (accion.estado === "error") {
            return base("error", { registradoEn, detalleTecnico, motivo: "No se pudo enviar el mensaje." });
        }

        const inicio = fechaValida(accion.ejecutado_en);

        if (inicio && ahora.getTime() - inicio.getTime() > EN_CURSO_ESTANCADO_MS) {
            return base("sin_confirmar", {
                registradoEn: inicio,
                motivo: "El envío empezó pero el sistema no registró si terminó."
            });
        }

        return base("enviando", { registradoEn: inicio });

    }

    // 2. Sin registro: depende de la configuración y del calendario real.
    if (!activo) return base("desactivado");

    if (!cicloAbierto) {
        return base("sin_evento", { motivo: "No hay un evento con la automatización en marcha en este grupo." });
    }

    if (!cierre) {
        return base("sin_hora", { motivo: "El evento no tiene una fecha y hora de cierre válidas." });
    }

    const momento = new Date(cierre.getTime() - offset * 60000);
    const hastaMomento = momento.getTime() - ahora.getTime();

    if (hastaMomento > PROXIMO_MS) return base("programado", { restanteMs: hastaMomento });
    if (hastaMomento > 0) return base("proximo", { restanteMs: hastaMomento });

    if (ahora.getTime() >= cierre.getTime()) {
        return base("no_enviado", { motivo: "Llegó la hora de cierre sin registro de este envío." });
    }

    if (-hastaMomento <= GRACIA_TICK_MS) return base("pendiente");

    return base("sin_registro", {
        motivo: "Ya pasó su hora y el sistema no registra el envío. Puede faltar un mensaje activo de esa categoría o no haber una sesión de WhatsApp activa."
    });

}

// -------------------------------------------------------------- resumen ---

export interface ResumenEnvios {
    proximo: ResultadoRecordatorio | null;
    ultimoEnviado: { tipo: string; en: Date } | null;
}

// Nombre sencillo de cada tipo_accion que escribe el backend.
export function nombreAccion(tipo: string): string {

    const recordatorio = /^REMINDER_(\d+)M$/.exec(tipo);

    if (recordatorio) return `Recordatorio ${recordatorio[1]} min antes`;
    if (tipo === "OPEN_MESSAGE") return "Mensaje de apertura";
    if (tipo === "CLOSE_MESSAGE") return "Mensaje de cierre";
    if (tipo === "UPDATE_MESSAGE") return "Actualización";
    if (tipo === "INITIAL_TABLE") return "Tabla inicial";
    if (tipo === "DAILY_START_MESSAGE") return "Inicio del día";

    return tipo;

}

export function resumirEnvios(recordatorios: ResultadoRecordatorio[], acciones: AccionRegistrada[]): ResumenEnvios {

    const proximo = recordatorios
        .filter((r) => (r.estado === "programado" || r.estado === "proximo") && r.restanteMs !== null)
        .sort((a, b) => (a.restanteMs as number) - (b.restanteMs as number))[0] || null;

    let ultimoEnviado: ResumenEnvios["ultimoEnviado"] = null;

    for (const accion of acciones) {

        if (accion.estado !== "ok") continue;

        const resultado = (accion.detalle?.resultado ?? null) as Record<string, unknown> | null;

        if (resultado && resultado.omitido === true) continue;

        const en = fechaValida(accion.finalizado_en) || fechaValida(accion.ejecutado_en);

        if (en && (!ultimoEnviado || en > ultimoEnviado.en)) {
            ultimoEnviado = { tipo: nombreAccion(accion.tipo_accion), en };
        }

    }

    return { proximo, ultimoEnviado };

}

// ------------------------------------------------------ grupo y conexión ---

export const SIN_NOMBRE = "Grupo sin nombre disponible";

// Primer nombre real disponible, en orden de fiabilidad: WhatsApp en vivo,
// el registrado con el evento, el último visto en mensajes. Nunca se
// muestra el identificador técnico como nombre.
export function resolverNombreGrupo(...candidatos: (string | null | undefined)[]): string {

    for (const candidato of candidatos) {
        const limpio = (candidato || "").trim();
        if (limpio && !limpio.endsWith("@g.us")) return limpio;
    }

    return SIN_NOMBRE;

}

export type ConexionGrupo = "conectado" | "no_visto" | "sin_sesion" | "no_verificable";

export interface SesionConsultada {
    estado: "conectada" | "desconectada" | "no_verificable";
    grupos: { id: string; nombre: string }[];
}

// A partir de la consulta real de grupos por sesión (gruposDisponibles.ts):
// solo una sesión que respondió con sus grupos prueba la conexión.
export function conexionDeGrupo(grupoId: string, sesiones: SesionConsultada[] | null): ConexionGrupo {

    if (!sesiones) return "no_verificable";

    const conectadas = sesiones.filter((s) => s.estado === "conectada");

    if (conectadas.some((s) => s.grupos.some((g) => g.id === grupoId))) return "conectado";
    if (conectadas.length > 0) return "no_visto";
    if (sesiones.some((s) => s.estado === "no_verificable")) return "no_verificable";

    return "sin_sesion";

}

// ------------------------------------------------------------- frescura ---

export type Frescura = "al_dia" | "desactualizado" | "sin_respuesta";

export function frescuraDatos(ultimaCarga: Date | null, ultimoIntentoFallo: boolean, ahora: Date): Frescura {

    if (ultimoIntentoFallo) return "sin_respuesta";
    if (!ultimaCarga) return "sin_respuesta";
    if (ahora.getTime() - ultimaCarga.getTime() > DATOS_VIEJOS_MS) return "desactualizado";

    return "al_dia";

}
