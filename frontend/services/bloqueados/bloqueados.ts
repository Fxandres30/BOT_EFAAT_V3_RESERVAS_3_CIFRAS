import { supabase } from "@/lib/supabase";

// Fase "Variables Globales + Bloqueados": SOLO lectura. Esta fase no
// inserta, actualiza ni elimina ningún registro de "bloqueados" — la
// tabla debe permanecer en 0 filas hasta que una fase futura autorice
// explícitamente la lógica de bloqueo real.

export interface FilaBloqueado {
    id: string;
    usuario_id: string;
    identificador: string;
    tipo: "telefono" | "jid" | "lid";
    motivo: string | null;
    creado_en: string;
    creado_por: string | null;
    activo: boolean;
}

export async function listarBloqueados(usuarioId: string) {

    return supabase
        .from("bloqueados")
        .select("*")
        .eq("usuario_id", usuarioId)
        .order("creado_en", { ascending: false });

}
