// La operación del negocio es en hora de Colombia (UTC-5, sin horario de
// verano). La fecha/hora de publicación se escribe y se muestra SIEMPRE en
// esa zona, sin importar la zona horaria del navegador.

const ZONA = "America/Bogota";

// "2026-10-15T10:30" (hora de Colombia) -> ISO UTC.
export function isoDesdeColombia(local: string): string | null {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
    const d = new Date(`${local}:00-05:00`);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ISO UTC -> "2026-10-15T10:30" (hora de Colombia), para el input.
export function colombiaDesdeIso(iso?: string | null): string {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const p = Object.fromEntries(
        new Intl.DateTimeFormat("en-CA", {
            timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit",
            hour: "2-digit", minute: "2-digit", hourCycle: "h23"
        }).formatToParts(d).map(x => [x.type, x.value])
    );
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

export function mostrarFecha(iso?: string | null): string {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return new Intl.DateTimeFormat("es-CO", { timeZone: ZONA, dateStyle: "medium", timeStyle: "short" }).format(d);
}
