import { supabase } from "@/lib/supabase";

export async function obtenerConfigMensajes(usuarioId: string) {

    return await supabase
        .from("configuracion_mensajes")
        .select("*")
        .eq("usuario_id", usuarioId);

}

export async function obtenerConfigMensaje(usuarioId: string, tipo: string) {

    return await supabase
        .from("configuracion_mensajes")
        .select("*")
        .eq("usuario_id", usuarioId)
        .eq("tipo", tipo)
        .maybeSingle();

}
