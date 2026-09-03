import { supabase } from "@/lib/supabase";

export async function getSession(id: string) {

    return await supabase

        .from("sesiones")

        .select("*")

        .eq("id", id)

        .maybeSingle();

}