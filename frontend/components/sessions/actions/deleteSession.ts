import { supabase } from "@/lib/supabase";

export async function deleteSession(
    id: string
) {

    const ok = confirm(
        "¿Seguro que deseas eliminar esta sesión?"
    );

    if (!ok) return;

    const { error } = await supabase

        .from("sesiones")

        .delete()

        .eq("id", id);

    if (error) {

        throw error;

    }

}