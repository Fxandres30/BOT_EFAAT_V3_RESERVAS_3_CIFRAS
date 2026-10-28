// Un sorteo publicado en varios grupos de WhatsApp se guarda como UNA fila de
// eventos_bot por grupo, todas con la misma identidad_evento_real (ver
// backend/bot/funciones/eventos/sorteoReal.js). El panel muestra UNA tarjeta
// por sorteo real y sus grupos como asociaciones.
//
// Clave = la misma del backend (claveSorteo): usuario + identidad. Así nunca
// se juntan sorteos de clientes distintos, y dos sorteos diferentes (otra
// identidad) siguen separados aunque compartan fecha, hora o grupo. Una fila
// sin identidad (anterior a la migración 015) es su propio sorteo.

import type { Evento } from "./types";

export interface GrupoAsociado {
    evento_id?: string;
    grupo_id?: string;
    grupo_nombre?: string | null;
    activo?: boolean;
    abierto?: boolean;
    estado?: string;
    cierre_motivo?: string | null;
}

export interface EventoCompartido extends Evento {
    clave: string;
    grupos: GrupoAsociado[];
}

export function claveEvento(evento: Evento): string {
    return evento.identidad_evento_real
        ? `${evento.usuario_id || ""}::${evento.identidad_evento_real}`
        : `evento::${evento.id}`;
}

function marcaTiempo(evento: Evento): number {
    const t = Date.parse(evento.actualizado_en || evento.creado_en || "");
    return Number.isFinite(t) ? t : 0;
}

// Fila que representa al sorteo: una activa si queda alguna (sus contadores
// son los que el bot mantiene al día) y, entre ellas, la más reciente.
function representante(filas: Evento[]): Evento {
    const activas = filas.filter((f) => f.activo !== false);
    const candidatas = activas.length ? activas : filas;
    return candidatas.reduce((a, b) => (marcaTiempo(b) > marcaTiempo(a) ? b : a));
}

export function agruparEventos(eventos: Evento[]): EventoCompartido[] {

    const porClave = new Map<string, Evento[]>();

    for (const evento of eventos || []) {
        const clave = claveEvento(evento);
        const filas = porClave.get(clave);
        if (filas) filas.push(evento);
        else porClave.set(clave, [evento]);
    }

    // Se conserva el orden de llegada (el de la consulta).
    return [...porClave.entries()].map(([clave, filas]) => {

        const base = representante(filas);
        const algunaActiva = filas.some((f) => f.activo !== false);

        return {
            ...base,
            clave,
            activo: algunaActiva,
            abierto: filas.some((f) => f.activo !== false && f.abierto === true),
            grupos: filas.map((f) => ({
                evento_id: f.id,
                grupo_id: f.grupo_id,
                grupo_nombre: f.grupo_nombre,
                activo: f.activo,
                abierto: f.abierto,
                estado: f.estado,
                cierre_motivo: f.cierre_motivo
            }))
        };

    });

}
