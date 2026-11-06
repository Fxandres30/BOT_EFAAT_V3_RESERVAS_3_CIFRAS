// La operación del negocio es en hora de Colombia (UTC-5, sin horario de
// verano). La fecha/hora de publicación se escribe y se muestra SIEMPRE en
// esa zona, sin importar la zona horaria del navegador.

import { DESFASE_COLOMBIA, ZONA_COLOMBIA as ZONA, partesColombia } from "../../lib/tiempo/colombia";

// "2026-10-15T10:30" (hora de Colombia) -> ISO UTC.
export function isoDesdeColombia(local: string): string | null {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
    const d = new Date(`${local}:00${DESFASE_COLOMBIA}`);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ISO UTC -> "2026-10-15T10:30" (hora de Colombia), para el input.
export function colombiaDesdeIso(iso?: string | null): string {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const { fecha, hora } = partesColombia(d);
    return `${fecha}T${hora}`;
}

export function mostrarFecha(iso?: string | null): string {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return new Intl.DateTimeFormat("es-CO", { timeZone: ZONA, dateStyle: "medium", timeStyle: "short" }).format(d);
}
