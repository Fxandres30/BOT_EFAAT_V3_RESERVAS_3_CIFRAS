// Eventos = centro de control de los sorteos en los grupos, vengan de donde
// vengan. Todo se DERIVA de lo que el backend ya devuelve:
//   - origen: los grupos de cada programación (GET /sorteos/gestion) guardan
//     evento_bot_id, la fila de eventos_bot que creó su publicación. Una
//     tarjeta cuyos grupos no salen de ninguna programación la detectó el
//     bot en WhatsApp.
//   - acciones: GET /sorteos/eventos agrupa por sorteo real (misma identidad)
//     con el estado de cada grupo; la tarjeta usa la entrada que comparte
//     alguno de sus eventos.

import type { BadgeTone } from "@/components/ui";
import type { SorteoEnGrupos } from "@/services/sorteos/apiSorteos";
import type { EventoCompartido } from "./agruparEventos";

export type OrigenEvento = "detectado" | "programado" | "instantaneo";

export const ETIQUETA_ORIGEN: Record<OrigenEvento, { texto: string; tono: BadgeTone; detalle: string }> = {
    detectado: { texto: "Detectado en WhatsApp", tono: "neutral", detalle: "EFAAT lo detectó en el anuncio del grupo." },
    programado: { texto: "Programado", tono: "primary", detalle: "Se publicó desde «Programados» a la hora indicada." },
    instantaneo: { texto: "Publicado ahora", tono: "warning", detalle: "Se publicó al momento desde «Publicar ahora»." }
};

interface ProgramacionConGrupos {
    config?: { publicacion_inmediata?: boolean } | null;
    grupos?: { evento_bot_id?: string | null }[] | null;
}

// evento_bot_id -> origen de la programación que lo publicó.
export function origenesPorEvento(programaciones: ProgramacionConGrupos[]): Map<string, OrigenEvento> {
    const mapa = new Map<string, OrigenEvento>();
    for (const p of programaciones || []) {
        const origen: OrigenEvento = p?.config?.publicacion_inmediata === true ? "instantaneo" : "programado";
        for (const g of p?.grupos || []) if (g?.evento_bot_id) mapa.set(g.evento_bot_id, origen);
    }
    return mapa;
}

const idsDe = (evento: Pick<EventoCompartido, "id" | "grupos">): string[] =>
    [evento.id, ...(evento.grupos || []).map(g => g.evento_id)].filter((x): x is string => !!x);

// Sin el listado de programaciones (backend caído o anterior) el origen no
// se inventa: null.
export function origenDe(evento: Pick<EventoCompartido, "id" | "grupos">, origenes: Map<string, OrigenEvento> | null): OrigenEvento | null {
    if (!origenes) return null;
    for (const id of idsDe(evento)) {
        const o = origenes.get(id);
        if (o) return o;
    }
    return "detectado";
}

// La entrada de administración (acciones por grupo) de esta tarjeta.
export function administrableDe(evento: Pick<EventoCompartido, "id" | "grupos" | "identidad_evento_real">, sorteos: SorteoEnGrupos[]): SorteoEnGrupos | null {
    const ids = new Set(idsDe(evento));
    return (sorteos || []).find(s => ids.has(s.id) || s.grupos.some(g => ids.has(g.evento_id)))
        || (evento.identidad_evento_real ? (sorteos || []).find(s => s.identidad === evento.identidad_evento_real) : undefined)
        || null;
}

// ?sorteo=<eventos_bot.id de cualquiera de sus grupos> abre su administración.
export function sorteoPorEvento(sorteos: SorteoEnGrupos[], eventoId: string | null): SorteoEnGrupos | null {
    if (!eventoId) return null;
    return (sorteos || []).find(s => s.id === eventoId || s.grupos.some(g => g.evento_id === eventoId)) || null;
}
