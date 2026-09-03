import { supabase } from "@/lib/supabase";

export async function createSession(
    usuarioId:string
){

    return await supabase

    .from("sesiones")

    .insert({

        usuario_id:usuarioId,

        nombre:"Nueva sesión",

        estado:"desconectado",

        principal:false

    });

}