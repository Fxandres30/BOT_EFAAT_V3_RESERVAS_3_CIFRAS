import { supabase } from "@/lib/supabase";

export interface GrupoConversacion {
    grupo_id: string;
    grupo_nombre: string | null;
}

type ClienteChats = Pick<typeof supabase, "from" | "auth">;

// No existe una vista/RPC de agregación (GROUP BY) expuesta todavía, así
// que se deduce la lista de grupos a partir de los mensajes recientes
// reales (sin inventar nombres ni contadores).
//
// AISLAMIENTO (2026-10-21): solo los mensajes que recibió el bot DEL USUARIO
// DE LA SESIÓN (cliente_usuario_id, migración 028; el usuario sale de
// Supabase Auth, nunca de un parámetro). Antes se leían los de todos los
// clientes. Sin sesión o sin la migración: nada (falla cerrado). La barrera
// real es la RLS de la migración 029.
export async function obtenerGruposConversacion(limite = 500, cliente: ClienteChats = supabase) {

    const { data: sesion } = await cliente.auth.getUser();
    const usuarioId = sesion?.user?.id;

    if (!usuarioId) {
        return { data: [] as GrupoConversacion[], error: null };
    }

    const { data, error } = await cliente
        .from("mensajes_grupos_sorteos")
        .select("grupo_id, grupo_nombre, timestamp_whatsapp")
        .eq("cliente_usuario_id", usuarioId)
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
