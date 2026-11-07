// ==========================================================================
// Centro de Automatizaciones — reglas puras (sin red ni Supabase).
//
// Todo lo que aquí se valida o se copia corresponde a columnas reales de
// automation_configs (006/008/009) y a lo que el backend realmente lee:
//   - recordatorios: scheduler.js::evaluarRecordatorios (minutos antes del
//     cierre real; los minutos se cuentan dentro del mismo día, así que el
//     máximo útil es 1439);
//   - variables: automation/variableResolver.js + engine.js::
//     construirVariablesDesdeEvento (una variable desconocida hace que el
//     mensaje NO se envíe, por eso se rechaza antes de guardar);
//   - umbral/espera: scheduler.js::evaluarActualizacion.
// ==========================================================================

import type { AutomationConfig, ConfigAccionSimple, ConfigRecordatorios } from "./automationConfigs";
import type { AccionRegistrada } from "./estadoProgramacion";

// ------------------------------------------------------- recordatorios ---

export const MINUTOS_MAXIMOS = 1439;

export function validarMinutos(texto: string, existentes: string[], actual: string | null = null): string | null {

    const limpio = texto.trim();

    if (!/^\d+$/.test(limpio)) return "Escribe los minutos como un número entero.";

    const minutos = Number(limpio);

    if (minutos < 1) return "Debe ser al menos 1 minuto antes del cierre.";
    if (minutos > MINUTOS_MAXIMOS) return `Como máximo ${MINUTOS_MAXIMOS} minutos (el mismo día del cierre).`;

    const clave = String(minutos);

    if (clave !== actual && existentes.includes(clave)) return `Ya existe una programación ${clave} minutos antes.`;

    return null;

}

export interface ProgramacionLista {
    minutos: number;
    clave: string;
    cfg: ConfigAccionSimple;
}

// Mayor anticipación primero (orden en que ocurren).
export function listarProgramaciones(recordatorios: ConfigRecordatorios | null | undefined): ProgramacionLista[] {

    return Object.entries(recordatorios || {})
        .map(([clave, cfg]) => ({ minutos: Number(clave), clave, cfg: { activo: cfg?.activo === true, categoria: cfg?.categoria ?? null } }))
        .filter((p) => Number.isFinite(p.minutos) && p.minutos >= 0)
        .sort((a, b) => b.minutos - a.minutos);

}

// Cambia la anticipación conservando activo/categoría. Devuelve un objeto
// nuevo (nunca muta el original).
export function cambiarMinutos(recordatorios: ConfigRecordatorios, desde: string, hasta: string): ConfigRecordatorios {

    if (desde === hasta || !recordatorios[desde]) return recordatorios;

    const copia: ConfigRecordatorios = {};

    for (const [clave, cfg] of Object.entries(recordatorios)) {
        if (clave === desde) copia[hasta] = { ...cfg };
        else copia[clave] = { ...cfg };
    }

    return copia;

}

// Siguiente anticipación libre para «Duplicar»: la mitad, o un minuto menos.
export function minutosParaDuplicado(recordatorios: ConfigRecordatorios, desde: number): number | null {

    const ocupados = new Set(Object.keys(recordatorios));
    const candidatos = [Math.floor(desde / 2), desde - 1, desde + 1];

    for (const c of candidatos) {
        if (c >= 1 && c <= MINUTOS_MAXIMOS && !ocupados.has(String(c))) return c;
    }

    for (let c = 1; c <= MINUTOS_MAXIMOS; c++) {
        if (!ocupados.has(String(c))) return c;
    }

    return null;

}

// ------------------------------------------------------------- reglas ---

export function validarUmbral(valor: number): string | null {
    if (!Number.isInteger(valor) || valor < 1) return "El umbral debe ser un número entero mayor o igual a 1.";
    return null;
}

export function validarEspera(valor: number): string | null {
    if (!Number.isInteger(valor) || valor < 0) return "La espera debe ser un número entero de minutos (0 o más).";
    return null;
}

export function validarHora(valor: string): string | null {
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(valor) ? null : "Indica una hora válida.";
}

// ----------------------------------------------------------- variables ---

// Mismo patrón que backend/automation/variableResolver.js.
const PATRON_VARIABLE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}|\{([a-zA-Z0-9_]+)\}/g;

// Exactamente las claves que construirVariablesDesdeEvento puede resolver.
export const VARIABLES_AUTOMATIZACION = [
    { nombre: "nombre_evento", descripcion: "Nombre del sorteo", ejemplo: "Lotería de Medellín" },
    { nombre: "evento", descripcion: "Nombre del sorteo (igual que nombre_evento)", ejemplo: "Lotería de Medellín" },
    { nombre: "loteria", descripcion: "Lotería (igual que el nombre del sorteo)", ejemplo: "Lotería de Medellín" },
    { nombre: "fecha", descripcion: "Fecha del sorteo", ejemplo: "2026-11-06" },
    { nombre: "valor", descripcion: "Valor del número", ejemplo: "5000" },
    { nombre: "hora_cierre", descripcion: "Hora de cierre", ejemplo: "22:30" },
    { nombre: "premio", descripcion: "Primer premio", ejemplo: "$500.000" },
    { nombre: "reservados", descripcion: "Números reservados", ejemplo: "42" },
    { nombre: "disponibles", descripcion: "Números libres", ejemplo: "58" }
] as const;

const NOMBRES_VARIABLES = new Set<string>(VARIABLES_AUTOMATIZACION.map((v) => v.nombre));

export function variablesDelTexto(texto: string): string[] {

    const vistas: string[] = [];

    for (const m of String(texto || "").matchAll(PATRON_VARIABLE)) {
        const nombre = m[1] || m[2];
        if (!vistas.includes(nombre)) vistas.push(nombre);
    }

    return vistas;

}

export function variablesDesconocidas(texto: string): string[] {
    return variablesDelTexto(texto).filter((v) => !NOMBRES_VARIABLES.has(v));
}

export function validarTextoMensaje(texto: string): string | null {

    if (!texto.trim()) return "El mensaje no puede quedar vacío.";

    const desconocidas = variablesDesconocidas(texto);

    if (desconocidas.length > 0) {
        return `Variables no disponibles: ${desconocidas.map((v) => `{${v}}`).join(", ")}. Con ellas el mensaje no se enviaría.`;
    }

    return null;

}

// Vista previa con datos de ejemplo (rotulados como tal en la interfaz).
export function vistaPreviaMensaje(texto: string): string {

    const ejemplos = Object.fromEntries(VARIABLES_AUTOMATIZACION.map((v) => [v.nombre, v.ejemplo])) as Record<string, string>;

    return String(texto || "").replace(PATRON_VARIABLE, (completo, dobles, simples) => {
        const nombre = dobles || simples;
        return Object.prototype.hasOwnProperty.call(ejemplos, nombre) ? ejemplos[nombre] : completo;
    });

}

// ------------------------------------------------ copia de configuración ---

export type BloqueCopia = "recordatorios" | "actualizacion" | "tabla_inicial" | "cierre" | "apertura" | "inicio_dia";

export const BLOQUES_COPIA: { id: BloqueCopia; label: string; columnas: (keyof AutomationConfig)[] }[] = [
    { id: "recordatorios", label: "Mensajes programados (recordatorios)", columnas: ["recordatorios"] },
    { id: "actualizacion", label: "Actualización, umbral y espera", columnas: ["mensaje_actualizacion", "umbral_reservas", "cooldown_minutos"] },
    { id: "tabla_inicial", label: "Tabla inicial", columnas: ["publicacion_inicial_tabla"] },
    { id: "cierre", label: "Mensaje de cierre", columnas: ["mensaje_cierre"] },
    { id: "apertura", label: "Mensaje de apertura", columnas: ["mensaje_apertura"] },
    { id: "inicio_dia", label: "Inicio del día", columnas: ["mensaje_inicio_dia"] }
];

// Copia profunda de las columnas elegidas. Nunca incluye `activo`, el
// usuario, el grupo ni los identificadores: cada grupo conserva su propio
// interruptor maestro y su identidad.
export function construirCopia(origen: AutomationConfig, bloques: BloqueCopia[]): Partial<AutomationConfig> {

    const cambios: Record<string, unknown> = {};

    for (const bloque of BLOQUES_COPIA) {
        if (!bloques.includes(bloque.id)) continue;
        for (const columna of bloque.columnas) {
            cambios[columna] = JSON.parse(JSON.stringify(origen[columna] ?? null));
        }
    }

    return cambios as Partial<AutomationConfig>;

}

export interface DestinoCopia {
    grupo_id: string;
    nombre: string;
    actualizado_en: string;
}

// Todo o nada: si un destino no es válido, no se aplica a ninguno.
export function validarCopia(origen: AutomationConfig, destinos: DestinoCopia[], bloques: BloqueCopia[], vigentes: Record<string, string | null>): string[] {

    const errores: string[] = [];

    if (bloques.length === 0) errores.push("Elige al menos una parte de la configuración para copiar.");
    if (destinos.length === 0) errores.push("Elige al menos un grupo de destino.");

    for (const d of destinos) {

        if (d.grupo_id === origen.grupo_id) {
            errores.push(`«${d.nombre}» es el grupo de origen.`);
            continue;
        }

        const vigente = vigentes[d.grupo_id];

        if (vigente === undefined || vigente === null) {
            errores.push(`«${d.nombre}» ya no tiene configuración guardada.`);
        } else if (new Date(vigente).getTime() !== new Date(d.actualizado_en).getTime()) {
            errores.push(`«${d.nombre}» cambió desde que abriste esta pantalla. Actualiza y vuelve a intentarlo.`);
        }

    }

    return errores;

}

// ------------------------------------------------------- borrador/guardado ---

export const COLUMNAS_EDITABLES = [
    "activo",
    "recordatorios",
    "mensaje_actualizacion",
    "umbral_reservas",
    "cooldown_minutos",
    "publicacion_inicial_tabla",
    "mensaje_cierre"
] as const;

export type ColumnaEditable = typeof COLUMNAS_EDITABLES[number];

function estable(valor: unknown): string {

    if (Array.isArray(valor)) return `[${valor.map(estable).join(",")}]`;

    if (valor && typeof valor === "object") {
        return `{${Object.keys(valor as Record<string, unknown>).sort().map((k) => `${JSON.stringify(k)}:${estable((valor as Record<string, unknown>)[k])}`).join(",")}}`;
    }

    return JSON.stringify(valor ?? null);

}

// Solo las columnas que de verdad cambiaron (lo que se envía al guardar).
export function columnasCambiadas(original: Partial<AutomationConfig>, borrador: Partial<AutomationConfig>): Partial<AutomationConfig> {

    const cambios: Record<string, unknown> = {};

    for (const columna of COLUMNAS_EDITABLES) {
        if (estable(original[columna]) !== estable(borrador[columna])) cambios[columna] = borrador[columna];
    }

    return cambios as Partial<AutomationConfig>;

}

// ---------------------------------------------------------- historial ---

export type EstadoHistorial = "enviado" | "omitido" | "fallido" | "en_curso" | "sin_confirmar";

export const ETIQUETA_HISTORIAL: Record<EstadoHistorial, string> = {
    enviado: "Enviado",
    omitido: "Omitido",
    fallido: "Fallido",
    en_curso: "En curso",
    sin_confirmar: "Sin confirmar"
};

const EN_CURSO_ESTANCADO_MS = 5 * 60 * 1000;

export function estadoHistorial(accion: Pick<AccionRegistrada, "estado" | "detalle" | "ejecutado_en">, ahora: Date): EstadoHistorial {

    if (accion.estado === "ok") {
        const resultado = (accion.detalle?.resultado ?? null) as Record<string, unknown> | null;
        return resultado?.omitido === true ? "omitido" : "enviado";
    }

    if (accion.estado === "error") return "fallido";

    const inicio = accion.ejecutado_en ? new Date(accion.ejecutado_en).getTime() : NaN;

    if (Number.isFinite(inicio) && ahora.getTime() - inicio > EN_CURSO_ESTANCADO_MS) return "sin_confirmar";

    return "en_curso";

}

const MOTIVOS: Record<string, string> = {
    automatizacion_desactivada: "La automatización del grupo estaba pausada.",
    grupo_cerrado: "El grupo ya estaba cerrado.",
    sin_disponibles: "No quedaban números libres.",
    sin_disponibles_ni_pendientes: "No quedaban números libres ni pagos pendientes."
};

export function motivoHistorial(accion: Pick<AccionRegistrada, "detalle">): string | null {

    const detalle = accion.detalle || null;

    if (!detalle) return null;

    const resultado = (detalle.resultado ?? null) as Record<string, unknown> | null;

    if (resultado && typeof resultado.motivo === "string") return MOTIVOS[resultado.motivo] || resultado.motivo;

    if (typeof detalle.mensaje === "string") return detalle.mensaje;

    return null;

}

// Grupo de la acción para filtrar por tipo en el historial.
export type TipoHistorial = "recordatorio" | "apertura" | "actualizacion" | "cierre" | "tabla" | "inicio_dia" | "sorteo" | "otro";

export const ETIQUETA_TIPO_HISTORIAL: Record<TipoHistorial, string> = {
    recordatorio: "Recordatorios",
    apertura: "Apertura",
    actualizacion: "Actualización",
    cierre: "Cierre",
    tabla: "Tabla",
    inicio_dia: "Inicio del día",
    sorteo: "Avisos del sorteo",
    otro: "Otros"
};

export function tipoHistorial(tipoAccion: string): TipoHistorial {

    if (/^REMINDER_\d+M$/.test(tipoAccion)) return "recordatorio";
    if (tipoAccion === "OPEN_MESSAGE") return "apertura";
    if (tipoAccion === "UPDATE_MESSAGE") return "actualizacion";
    if (tipoAccion === "CLOSE_MESSAGE") return "cierre";
    if (tipoAccion === "INITIAL_TABLE" || tipoAccion === "TABLA_COMPARTIR") return "tabla";
    if (tipoAccion === "DAILY_START_MESSAGE") return "inicio_dia";
    if (tipoAccion.startsWith("SORTEO_")) return "sorteo";

    return "otro";

}

// ------------------------------------------------------------ filtros ---

export type FiltroConexion = "todos" | "conectado" | "desconectado";
export type FiltroAutomatizacion = "todos" | "activa" | "desactivada";
export type FiltroEvento = "todos" | "con_evento" | "sin_evento";

export interface FiltrosCentro {
    texto: string;
    conexion: FiltroConexion;
    automatizacion: FiltroAutomatizacion;
    evento: FiltroEvento;
}

export interface FilaFiltrable {
    nombre: string;
    grupo_id: string;
    conectado: boolean | null; // null = comprobando / sin verificar
    activo: boolean;
    conEvento: boolean;
}

function sinAcentos(texto: string): string {
    return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function filtrarFilas<T extends FilaFiltrable>(filas: T[], filtros: FiltrosCentro): T[] {

    const buscado = sinAcentos(filtros.texto.trim());

    return filas.filter((f) => {

        if (buscado && !sinAcentos(f.nombre).includes(buscado) && !f.grupo_id.toLowerCase().includes(buscado)) return false;

        if (filtros.conexion === "conectado" && f.conectado !== true) return false;
        if (filtros.conexion === "desconectado" && f.conectado !== false) return false;

        if (filtros.automatizacion === "activa" && !f.activo) return false;
        if (filtros.automatizacion === "desactivada" && f.activo) return false;

        if (filtros.evento === "con_evento" && !f.conEvento) return false;
        if (filtros.evento === "sin_evento" && f.conEvento) return false;

        return true;

    });

}
