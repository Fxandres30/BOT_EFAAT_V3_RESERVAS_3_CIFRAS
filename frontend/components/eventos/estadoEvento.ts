// Estado de un sorteo de eventos_bot tal como lo entiende el backend
// (backend/shared/eventos/estadosGestion.js y sorteos/gestionEventos.js):
// activo -> en curso; inactivo -> desactivado, cancelado o sustituido si así
// lo dejó la administración (en `estado` o en `cierre_motivo`), si no
// cerrado. Antes Eventos mostraba el texto crudo de `estado` y «Cerrado»
// para cualquier grupo inactivo, aunque se hubiera desactivado o cancelado.

import type { StatusKind } from "@/components/ui/Badge";

export type EstadoEvento = "en_curso" | "cerrado" | "desactivado" | "cancelado" | "sustituido";

interface FilaEstado {
    activo?: boolean | null;
    estado?: string | null;
    cierre_motivo?: string | null;
}

const GESTION = ["desactivado", "cancelado", "eliminado"];

function motivoGestion(f: FilaEstado): string | null {
    if (f.estado && GESTION.includes(f.estado)) return f.estado;
    const motivo = String(f.cierre_motivo || "");
    if (motivo.startsWith("panel:")) {
        const m = motivo.slice("panel:".length).split(/[\s:]/)[0];
        if (GESTION.includes(m)) return m;
    }
    if (motivo.startsWith("sustituido")) return "sustituido";
    return null;
}

// Mismo criterio de «activo» que agruparEventos (null/undefined = activo).
export function estadoFila(f: FilaEstado): EstadoEvento {
    if (f.activo !== false) return "en_curso";
    const m = motivoGestion(f);
    return m === "desactivado" || m === "cancelado" || m === "sustituido" ? m : "cerrado";
}

// Estado del sorteo completo (todos sus grupos): en curso si lo está en
// alguno; si no, el de la primera fila (la representante).
export function estadoSorteo(filas: FilaEstado[]): EstadoEvento {
    if (!filas.length) return "cerrado";
    return filas.some(f => f.activo !== false) ? "en_curso" : estadoFila(filas[0]);
}

export const ETIQUETA_ESTADO: Record<EstadoEvento, { texto: string; kind: StatusKind }> = {
    en_curso: { texto: "En curso", kind: "active" },
    cerrado: { texto: "Cerrado", kind: "inactive" },
    desactivado: { texto: "Desactivado", kind: "warning" },
    cancelado: { texto: "Cancelado", kind: "offline" },
    sustituido: { texto: "Sustituido", kind: "inactive" }
};

// Gestión real de ESE sorteo: Eventos abre su administración (EventoGrid lee
// ?sorteo=). Los enlaces antiguos /sorteos?vista=administrar redirigen aquí.
export function enlaceAdministrar(eventoId?: string | null): string {
    return eventoId ? `/eventos?sorteo=${encodeURIComponent(eventoId)}` : "/eventos";
}
