import { supabase } from "@/lib/supabase";

export async function updateSession(

    id:string,

    values:any

){

    return await supabase

    .from("sesiones")

    .update(values)

    .eq("id",id);

}