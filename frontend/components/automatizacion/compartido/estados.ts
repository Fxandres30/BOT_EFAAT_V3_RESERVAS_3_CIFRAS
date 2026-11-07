import type { BadgeTone } from "@/components/ui/Badge";
import type { AutorizacionVista, AutomatizacionVista, ConexionVista } from "@/services/automatizacion/vistaGrupos";

// Textos visibles de cada estado — una sola fuente para Resumen, Grupos y
// Centro de control. Lenguaje sencillo, sin nombres internos.

export const CONEXION: Record<ConexionVista, { texto: string; tono: BadgeTone; explicacion: string }> = {
    conectado: {
        texto: "Conectado", tono: "success",
        explicacion: "Tu WhatsApp ve este grupo ahora mismo. Los mensajes automáticos pueden salir."
    },
    no_visto: {
        texto: "No aparece en WhatsApp", tono: "error",
        explicacion: "Tu WhatsApp está conectado, pero no reporta este grupo: pudo eliminarse o tu número ya no forma parte de él."
    },
    sin_sesion: {
        texto: "WhatsApp desconectado", tono: "error",
        explicacion: "Ningún WhatsApp vinculado está conectado. Reconéctalo en «Sesiones»."
    },
    no_verificable: {
        texto: "Sin verificar", tono: "warning",
        explicacion: "No pudimos comprobar tu WhatsApp en este momento. No significa que esté desconectado."
    },
    comprobando: {
        texto: "Comprobando…", tono: "neutral",
        explicacion: "Consultando tu WhatsApp en vivo."
    }
};

export const AUTORIZACION: Record<AutorizacionVista, { texto: string; tono: BadgeTone; explicacion: string }> = {
    autorizado: {
        texto: "Autorizado", tono: "success",
        explicacion: "EFAAT puede automatizar este grupo."
    },
    pausada: {
        texto: "Autorización pausada", tono: "warning",
        explicacion: "El grupo estuvo autorizado, pero su autorización está desactivada. Puedes reactivarla cuando quieras."
    },
    no_autorizado: {
        texto: "No autorizado", tono: "neutral",
        explicacion: "EFAAT no enviará mensajes automáticos a este grupo hasta que lo autorices."
    }
};

export const AUTOMATIZACION: Record<AutomatizacionVista, { texto: string; tono: BadgeTone; explicacion: string }> = {
    activa: {
        texto: "Automatización activa", tono: "primary",
        explicacion: "Los mensajes configurados se envían en su momento."
    },
    pausada: {
        texto: "Automatización pausada", tono: "neutral",
        explicacion: "No saldrá ningún mensaje automático nuevo hasta reactivarla. La configuración se conserva."
    },
    sin_configurar: {
        texto: "Sin configurar", tono: "neutral",
        explicacion: "Todavía no tiene automatización. Ábrelo con «Configurar» para crearla."
    }
};

export const TIPOS_VISIBLES = [
    { clave: "apertura", texto: "Apertura" },
    { clave: "recordatorios", texto: "Recordatorios" },
    { clave: "actualizacion", texto: "Actualizaciones" },
    { clave: "cierre", texto: "Cierre" }
] as const;

// ------------------------------------------------------------- formato ---

const FORMATO_HORA_LEGIBLE = new Intl.DateTimeFormat("es-CO", { timeZone: "UTC", hour: "numeric", minute: "2-digit", hour12: true });

// "07:00" → "7:00 a. m." — mismo estilo que formatearMomento ("hoy 2:18
// p. m."), para que toda la sección escriba la hora igual.
export function horaLegible(hhmm: string | null | undefined): string {
    const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm ?? "").trim());
    if (!m) return String(hhmm ?? "");
    return FORMATO_HORA_LEGIBLE.format(new Date(Date.UTC(2000, 0, 1, Number(m[1]), Number(m[2]))));
}

// Tiempo restante corto para tarjetas: "18 min", "2 h 58 min", "menos de 1 min".
export function restanteCorto(ms: number): string {
    if (ms < 60000) return "menos de 1 min";
    const totalMin = Math.round(ms / 60000);
    const h = Math.floor(totalMin / 60);
    const min = totalMin % 60;
    if (h === 0) return `${min} min`;
    return min === 0 ? `${h} h` : `${h} h ${min} min`;
}
