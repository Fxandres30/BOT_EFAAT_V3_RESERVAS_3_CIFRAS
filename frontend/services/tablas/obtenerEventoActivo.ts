import { supabase } from "@/lib/supabase";
import type { EventoActivo } from "@/components/tablas/types";

// Evento actualmente activo para una tabla física + usuario. A lo sumo
// uno (el bot mantiene un solo evento "activo" por tabla). Puede no haber
// ninguno — eso es información real, no un error.
export async function obtenerEventoActivo(
    tabla: string,
    usuarioId: string
): Promise<EventoActivo | null> {

    const { data, error } = await supabase
        .from("eventos_bot")
        .select("*")
        .eq("tabla", tabla)
        .eq("usuario_id", usuarioId)
        .eq("activo", true)
        .order("creado_en", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error)
        throw error;

    return data as EventoActivo | null;

}
