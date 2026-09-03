import { supabase } from "@/lib/supabase";

export async function obtenerMensajesGrupo(grupoId: string, limite = 200) {

    return await supabase
        .from("mensajes_grupos_sorteos")
        .select("id, texto, nombre, push_name, from_me, tipo_mensaje, timestamp_whatsapp, accion, estado")
        .eq("grupo_id", grupoId)
        .order("timestamp_whatsapp", { ascending: false })
        .limit(limite);

}
