import { supabase } from "@/lib/supabase";

export async function getSessions(
    usuarioId: string
) {

    return await supabase

        .from("sesiones")

        .select("*")

        .eq("usuario_id", usuarioId)

        .order("created_at", {

            ascending: true

        });

}