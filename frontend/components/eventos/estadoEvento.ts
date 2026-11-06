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

// FUENTE ÚNICA DEL PANEL para el estado de una fila de eventos_bot (F2,
// 06/11/2026). Espejo de backend/shared/eventos/estadosGestion.js:
// motivoGestion y eliminado son la misma regla (lo comprueba
// backend/tests/caracterizacion/criteriosEstadoSorteo.test.js). Nada en el
// panel debe volver a combinar activo/estado/cierre_motivo a mano.
export function motivoGestion(f: FilaEstado): string | null {
    if (f.estado && GESTION.includes(f.estado)) return f.estado;
    // Fila normalizada (F3): el motivo original sigue después del prefijo.
    let motivo = String(f.cierre_motivo || "");
    if (motivo.startsWith("normalizado: ")) motivo = motivo.slice("normalizado: ".length);
    if (motivo.startsWith("panel:")) {
        const m = motivo.slice("panel:".length).split(/[\s:]/)[0];
        if (GESTION.includes(m)) return m;
    }
    if (motivo.startsWith("sustituido")) return "sustituido";
    return null;
}

// Eliminación lógica desde «Administrar»: la fila se conserva y no se muestra.
export function eliminado(f: FilaEstado): boolean {
    return motivoGestion(f) === "eliminado";
}

// «En curso» en Eventos: MISMO criterio que el backend
// (estadosGestion.enCursoPorActivo / gestionEventos.estadoFila), para que el
// panel y el backend muestren exactamente el mismo estado (regla 3, F2).
// REGLA F2 (06/11/2026): antes el panel daba por en curso cualquier fila con
// activo distinto de false, también activo NULL; el backend la mostraba
// cerrada. Ahora NULL = cerrada en los dos (regla 4; «inerte para el bot»
// desde el 22/10). Una fila activo=true ya terminada (C3) sigue «en curso» en
// los dos hasta F3: sus acciones (cerrar/reabrir) dependen de activo.
export function enCursoPorActivo(f: FilaEstado): boolean {
    return f.activo === true;
}

export function estadoFila(f: FilaEstado): EstadoEvento {
    if (enCursoPorActivo(f)) return "en_curso";
    const m = motivoGestion(f);
    return m === "desactivado" || m === "cancelado" || m === "sustituido" ? m : "cerrado";
}

// Estado del sorteo completo (todos sus grupos): en curso si lo está en
// alguno; si no, el de la primera fila (la representante).
export function estadoSorteo(filas: FilaEstado[]): EstadoEvento {
    if (!filas.length) return "cerrado";
    return filas.some(enCursoPorActivo) ? "en_curso" : estadoFila(filas[0]);
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
