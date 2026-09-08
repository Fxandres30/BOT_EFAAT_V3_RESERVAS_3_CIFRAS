import { supabase } from "@/lib/supabase";

// grupos_autorizados — SIN cambios de esquema respecto a
// backend/supabase_migrations/006_automation_engine.sql. Este archivo solo
// lee/escribe esa misma tabla, con el usuario autenticado real (nunca un
// usuario_id que llegue libremente del cliente) — RLS
// (auth.uid() = usuario_id) es la protección real; usuarioId aquí siempre
// sale de supabase.auth (ver services/auth/getUser.ts), nunca de un input.
export interface GrupoAutorizado {
    id: string;
    usuario_id: string;
    grupo_id: string;
    activo: boolean;
    creado_en: string;
    actualizado_en: string;
}

export async function listarGruposAutorizados(usuarioId: string) {

    return await supabase
        .from("grupos_autorizados")
        .select("*")
        .eq("usuario_id", usuarioId)
        .order("creado_en", { ascending: false });

}

// Autoriza (o re-autoriza) un grupo puntual — nunca todos a la vez (Fase
// 4C, paso 5: "NO autorizar todos los grupos"). Upsert sobre
// unique(usuario_id, grupo_id) — si el usuario ya lo había desautorizado
// antes, esto lo reactiva sin duplicar la fila.
export async function autorizarGrupo(usuarioId: string, grupoId: string) {

    return await supabase
        .from("grupos_autorizados")
        .upsert(
            {
                usuario_id: usuarioId,
                grupo_id: grupoId,
                activo: true,
                actualizado_en: new Date().toISOString()
            },
            { onConflict: "usuario_id,grupo_id" }
        )
        .select()
        .single();

}

export async function alternarGrupoAutorizado(id: string, activo: boolean) {

    return await supabase
        .from("grupos_autorizados")
        .update({ activo, actualizado_en: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single();

}
