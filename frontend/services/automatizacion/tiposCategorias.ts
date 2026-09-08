// Constantes compartidas del panel de Automatización — reflejan
// EXACTAMENTE los valores que el backend ya usa (ver
// backend/supabase_migrations/007_automation_messages.sql, comentario de
// cabecera: "tipo"/"categoria" son texto libre, sin CHECK, a propósito).
// Este archivo no inventa ningún tipo/categoría nueva — es la misma lista
// que ya documenta 007.

export interface TipoAutomatizacion {
    id: "OPEN_MESSAGE" | "REMINDER_MESSAGE" | "UPDATE_MESSAGE" | "CLOSE_MESSAGE";
    label: string;
    icono: string;
}

export const TIPOS_AUTOMATIZACION: TipoAutomatizacion[] = [
    { id: "OPEN_MESSAGE", label: "Apertura", icono: "🚀" },
    { id: "REMINDER_MESSAGE", label: "Recordatorio", icono: "⏰" },
    { id: "UPDATE_MESSAGE", label: "Actualización", icono: "🔄" },
    { id: "CLOSE_MESSAGE", label: "Cierre", icono: "🔒" }
];

export function nombreTipo(tipo: string): string {
    return TIPOS_AUTOMATIZACION.find((t) => t.id === tipo)?.label || tipo;
}

export interface CategoriaAutomatizacion {
    id: string;
    label: string;
}

export const CATEGORIAS_AUTOMATIZACION: CategoriaAutomatizacion[] = [
    { id: "eleccion", label: "Elección" },
    { id: "escasez", label: "Escasez" },
    { id: "humor", label: "Humor" },
    { id: "competencia", label: "Competencia" },
    { id: "tiempo", label: "Tiempo" },
    { id: "curiosidad", label: "Curiosidad" },
    { id: "accion", label: "Acción" },
    { id: "urgencia", label: "Urgencia" },
    { id: "familiar", label: "Familiar" },
    { id: "movimiento", label: "Movimiento" }
];

export function nombreCategoria(categoria: string | null): string {
    if (!categoria) return "Sin categoría";
    return CATEGORIAS_AUTOMATIZACION.find((c) => c.id === categoria)?.label || categoria;
}

// Las únicas variables reales que automation/engine.js
// (construirVariablesDesdeEvento) puede resolver — nunca se inventa
// ninguna otra. Mostradas como ayuda debajo del editor de mensajes.
export const VARIABLES_PERMITIDAS = [
    { variable: "{nombre_evento}", descripcion: "Nombre del sorteo" },
    { variable: "{valor}", descripcion: "Valor del número" },
    { variable: "{hora_cierre}", descripcion: "Hora de cierre" },
    { variable: "{premio}", descripcion: "Primer premio del evento" },
    { variable: "{reservados}", descripcion: "Números reservados" },
    { variable: "{disponibles}", descripcion: "Números disponibles (libres)" }
];

export const DIAS_SEMANA = [
    { id: "lunes", label: "Lunes" },
    { id: "martes", label: "Martes" },
    { id: "miercoles", label: "Miércoles" },
    { id: "jueves", label: "Jueves" },
    { id: "viernes", label: "Viernes" },
    { id: "sabado", label: "Sábado" },
    { id: "domingo", label: "Domingo" }
];
