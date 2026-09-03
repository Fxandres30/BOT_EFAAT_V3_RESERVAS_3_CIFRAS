import { supabase } from "@/lib/supabase";

export async function deleteSession(
    id:string
){

    return await supabase

    .from("sesiones")

    .delete()

    .eq("id",id);

}