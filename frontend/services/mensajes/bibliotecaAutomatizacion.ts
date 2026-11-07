// ==========================================================================
// Biblioteca de MENSAJES DE AUTOMATIZACIÓN — reglas puras (sin red).
//
// Une en UNA sola lista las dos fuentes que ya existen, sin mover datos:
//   - automation_messages (apertura, recordatorio, actualización y cierre;
//     propios y «De EFAAT»), que lee automation/messageSelector.js;
//   - plantillas_mensaje con tipo_respuesta = "inicio_dia", que lee
//     automation/scheduler.js para el Inicio del día.
// Cada elemento conserva su origen, su id y la fila original, y se guarda
// SIEMPRE en su propia tabla (bibliotecaAutomatizacionDatos.ts). Ninguno
// cambia de tabla ni de identificador.
//
// Categorías: ya no se muestran ni se piden. La columna `categoria` de
// automation_messages se conserva tal cual (las configuraciones de
// Automatización pueden seguir filtrando por ella): editar un mensaje no la
// toca y duplicarlo la copia.
// ==========================================================================

import { TIPOS_AUTOMATIZACION, VARIABLES_PERMITIDAS } from "../automatizacion/tiposCategorias";

export type OrigenBiblioteca = "automatizacion" | "inicio_dia";

export const TIPO_INICIO_DIA = "inicio_dia";

export interface TipoBiblioteca {
    id: string;
    label: string;
    icono: string;
    origen: OrigenBiblioteca;
}

// Los cinco tipos, en el orden del día: Inicio del día, Apertura,
// Recordatorio, Actualización y Cierre. Los cuatro de automation_messages
// conservan exactamente sus ids (OPEN_MESSAGE…).
export const TIPOS_BIBLIOTECA: TipoBiblioteca[] = [
    { id: TIPO_INICIO_DIA, label: "Inicio del día", icono: "🌅", origen: "inicio_dia" },
    ...TIPOS_AUTOMATIZACION.map((t) => ({ id: t.id, label: t.label, icono: t.icono, origen: "automatizacion" as const }))
];

export function esTipoBiblioteca(id: string | null | undefined): boolean {
    return !!id && TIPOS_BIBLIOTECA.some((t) => t.id === id);
}

export function origenDeTipo(tipo: string): OrigenBiblioteca {
    return tipo === TIPO_INICIO_DIA ? "inicio_dia" : "automatizacion";
}

export function nombreTipoBiblioteca(tipo: string): string {
    return TIPOS_BIBLIOTECA.find((t) => t.id === tipo)?.label || tipo;
}

export interface MensajeBiblioteca<T = unknown> {
    clave: string;              // única en la lista: "<origen>:<id>"
    id: string;                 // id REAL de su tabla (nunca cambia)
    origen: OrigenBiblioteca;
    usuario_id: string | null;  // null = mensaje de EFAAT (solo automation_messages)
    nombre: string;
    texto: string;
    tipo: string;
    activo: boolean;
    fecha: string | null;       // para ordenar (más recientes primero)
    fila: T;                    // fila original, intacta
}

interface FilaAutomatizacion {
    id: string; usuario_id: string | null; nombre_interno: string; texto: string; tipo: string; activo: boolean; creado_en?: string | null;
}

interface FilaInicioDia {
    id: string; usuario_id: string; nombre: string; contenido: string; habilitada: boolean; created_at?: string | null; tipo_respuesta?: string;
}

export function desdeAutomatizacion<T extends FilaAutomatizacion>(m: T): MensajeBiblioteca<T> {
    return { clave: `automatizacion:${m.id}`, id: m.id, origen: "automatizacion", usuario_id: m.usuario_id, nombre: m.nombre_interno, texto: m.texto, tipo: m.tipo, activo: m.activo, fecha: m.creado_en ?? null, fila: m };
}

export function desdeInicioDia<T extends FilaInicioDia>(p: T): MensajeBiblioteca<T> {
    return { clave: `inicio_dia:${p.id}`, id: p.id, origen: "inicio_dia", usuario_id: p.usuario_id, nombre: p.nombre, texto: p.contenido, tipo: TIPO_INICIO_DIA, activo: p.habilitada, fecha: p.created_at ?? null, fila: p };
}

export interface FiltrosBiblioteca {
    tipo?: string | null;
    estado?: "todos" | "activos" | "inactivos";
}

// ¿Qué fuentes hay que leer para estos filtros?
export function fuentesParaFiltro(tipo: string | null | undefined): { automatizacion: boolean; inicioDia: boolean } {
    if (!tipo) return { automatizacion: true, inicioDia: true };
    return tipo === TIPO_INICIO_DIA ? { automatizacion: false, inicioDia: true } : { automatizacion: true, inicioDia: false };
}

const ORDEN_TIPO = new Map(TIPOS_BIBLIOTECA.map((t, i) => [t.id, i]));

// Filtra por tipo y estado y ordena por tipo (orden del día) y, dentro de
// cada tipo, de más reciente a más antiguo. Un tipo desconocido (texto
// libre en la tabla) va al final y nunca se pierde.
export function filtrarYOrdenar<T>(mensajes: MensajeBiblioteca<T>[], filtros: FiltrosBiblioteca = {}): MensajeBiblioteca<T>[] {
    return mensajes
        .filter((m) => !filtros.tipo || m.tipo === filtros.tipo)
        .filter((m) => filtros.estado === "activos" ? m.activo : filtros.estado === "inactivos" ? !m.activo : true)
        .sort((a, b) => {
            const ta = ORDEN_TIPO.get(a.tipo) ?? 99;
            const tb = ORDEN_TIPO.get(b.tipo) ?? 99;
            if (ta !== tb) return ta - tb;
            return String(b.fecha || "").localeCompare(String(a.fecha || ""));
        });
}

export function resumen<T>(mensajes: MensajeBiblioteca<T>[]): { total: number; activos: number; inactivos: number } {
    const activos = mensajes.filter((m) => m.activo).length;
    return { total: mensajes.length, activos, inactivos: mensajes.length - activos };
}

// Variables que el editor ofrece según el tipo. Cada motor usa su sintaxis:
//   automatización → {nombre_evento} (automation/variableResolver.js)
//   Inicio del día → {{evento}} (catálogo global, shared/variables) — a esa
//   hora normalmente aún no hay sorteo, así que suelen quedar vacías.
export interface VariableBiblioteca { variable: string; descripcion: string }

export const VARIABLES_INICIO_DIA: VariableBiblioteca[] = [
    { variable: "{{evento}}", descripcion: "Nombre del sorteo" },
    { variable: "{{loteria}}", descripcion: "Lotería" },
    { variable: "{{premio}}", descripcion: "Premio principal" }
];

export function variablesDeTipo(tipo: string): VariableBiblioteca[] {
    return origenDeTipo(tipo) === "inicio_dia" ? VARIABLES_INICIO_DIA : VARIABLES_PERMITIDAS;
}

// ¿Se puede cambiar el tipo de un mensaje YA guardado? Solo dentro de la
// misma tabla: pasar de Inicio del día a Apertura (o al revés) obligaría a
// mover la fila de tabla y cambiar su id.
export function tiposEditables(tipoActual: string | null): TipoBiblioteca[] {
    if (!tipoActual) return TIPOS_BIBLIOTECA;
    const origen = origenDeTipo(tipoActual);
    return TIPOS_BIBLIOTECA.filter((t) => t.origen === origen);
}
