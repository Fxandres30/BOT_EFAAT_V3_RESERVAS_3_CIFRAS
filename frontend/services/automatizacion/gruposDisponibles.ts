import { getSessions } from "@/services/sessions/getSessions";

// Grupos REALES de WhatsApp, agrupados por sesión conectada — Fase 4D.
//
// Fuente: sesiones (Supabase, RLS-scoped por usuario_id — REUTILIZADA vía
// getSessions(), sin duplicar) para saber CUÁLES sesiones son mías y
// cuáles están conectadas; luego, para cada una, el backend (socket real
// de Baileys de esa sesión, manager.get() + groupFetchAllParticipating())
// — NUNCA mensajes_grupos_sorteos como única fuente, y NUNCA se guarda
// nada en Supabase solo por listar.
export interface GrupoDisponible {
    id: string;
    nombre: string;
}

export interface SesionConGrupos {
    sessionId: string;
    nombreSesion: string;
    telefono: string | null;
    grupos: GrupoDisponible[];
    error: string | null;
}

export async function obtenerGruposDisponibles(usuarioId: string): Promise<SesionConGrupos[]> {

    const { data: sesiones, error } = await getSessions(usuarioId);

    if (error || !sesiones) {
        return [];
    }

    const conectadas = sesiones.filter((s: { estado: string }) => s.estado === "conectado");

    const resultados = await Promise.all(

        conectadas.map(async (sesion: { id: string; nombre: string; telefono: string | null }) => {

            try {

                const res = await fetch(`/api/sessions/grupos-disponibles?id=${encodeURIComponent(sesion.id)}`);
                const data = await res.json();

                if (!data.success) {

                    return {
                        sessionId: sesion.id,
                        nombreSesion: sesion.nombre,
                        telefono: sesion.telefono,
                        grupos: [],
                        error: data.error || "No se pudieron cargar los grupos de esta sesión."
                    };

                }

                return {
                    sessionId: sesion.id,
                    nombreSesion: sesion.nombre,
                    telefono: sesion.telefono,
                    grupos: (data.grupos || []) as GrupoDisponible[],
                    error: null
                };

            } catch (err) {

                return {
                    sessionId: sesion.id,
                    nombreSesion: sesion.nombre,
                    telefono: sesion.telefono,
                    grupos: [],
                    error: err instanceof Error ? err.message : "Error de red."
                };

            }

        })

    );

    return resultados;

}
