import { supabase } from "@/lib/supabase";

type ClienteChats = Pick<typeof supabase, "from" | "auth">;

// Solo los mensajes de ese grupo que recibió el bot DEL USUARIO DE LA SESIÓN
// (cliente_usuario_id, migración 028). Aunque otro cliente esté en el mismo
// grupo, sus copias no se ven. Sin sesión: nada. Barrera real: RLS de la 029.
export async function obtenerMensajesGrupo(grupoId: string, limite = 200, cliente: ClienteChats = supabase) {

    const { data: sesion } = await cliente.auth.getUser();
    const usuarioId = sesion?.user?.id;

    if (!usuarioId) {
        return { data: [], error: null };
    }

    return await cliente
        .from("mensajes_grupos_sorteos")
        .select("id, texto, nombre, push_name, from_me, tipo_mensaje, timestamp_whatsapp, accion, estado")
        .eq("cliente_usuario_id", usuarioId)
        .eq("grupo_id", grupoId)
        .order("timestamp_whatsapp", { ascending: false })
        .limit(limite);

}
