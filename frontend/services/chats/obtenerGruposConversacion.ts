import { supabase } from "@/lib/supabase";

export interface GrupoConversacion {
    grupo_id: string;
    grupo_nombre: string | null;
}

// No existe una vista/RPC de agregación (GROUP BY) expuesta todavía, así
// que se deduce la lista de grupos a partir de los mensajes recientes
// reales (sin inventar nombres ni contadores).
export async function obtenerGruposConversacion(limite = 500) {

    const { data, error } = await supabase
        .from("mensajes_grupos_sorteos")
        .select("grupo_id, grupo_nombre, timestamp_whatsapp")
        .order("timestamp_whatsapp", { ascending: false })
        .limit(limite);

    if (error || !data) {
        return { data: [] as GrupoConversacion[], error };
    }

    const vistos = new Map<string, GrupoConversacion>();

    for (const fila of data) {
        if (!vistos.has(fila.grupo_id)) {
            vistos.set(fila.grupo_id, {
                grupo_id: fila.grupo_id,
                grupo_nombre: fila.grupo_nombre
            });
        }
    }

    return { data: Array.from(vistos.values()), error: null };

}
