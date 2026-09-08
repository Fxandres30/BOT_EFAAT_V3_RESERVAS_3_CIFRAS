import { supabase } from "@/lib/supabase";
import type { TablaDiseno, TablaDisenoConfig } from "@/components/tablas/disenoTypes";

// CRUD de la BIBLIOTECA de diseños del usuario (public.tabla_disenos).
// Nunca modifica tabla_configuracion_visual — aplicar un diseño a una
// tabla es responsabilidad de configuracionVisual.ts (copia
// independiente, ver esa auditoría).

export async function listarDisenos(usuarioId: string): Promise<TablaDiseno[]> {

    const { data, error } = await supabase
        .from("tabla_disenos")
        .select("*")
        .eq("usuario_id", usuarioId)
        .order("actualizado_en", { ascending: false });

    if (error) throw error;

    return (data || []) as TablaDiseno[];

}

export async function crearDiseno(
    usuarioId: string,
    nombre: string,
    config: TablaDisenoConfig
): Promise<TablaDiseno> {

    const { data, error } = await supabase
        .from("tabla_disenos")
        .insert({ usuario_id: usuarioId, nombre, config })
        .select()
        .single();

    if (error) throw error;

    return data as TablaDiseno;

}

export async function actualizarDiseno(
    id: string,
    cambios: { nombre?: string; config?: TablaDisenoConfig }
): Promise<TablaDiseno> {

    const { data, error } = await supabase
        .from("tabla_disenos")
        .update({ ...cambios, actualizado_en: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single();

    if (error) throw error;

    return data as TablaDiseno;

}

export async function duplicarDiseno(diseno: TablaDiseno): Promise<TablaDiseno> {
    return crearDiseno(diseno.usuario_id, `${diseno.nombre} (copia)`, diseno.config);
}

export async function eliminarDiseno(id: string): Promise<void> {

    const { error } = await supabase
        .from("tabla_disenos")
        .delete()
        .eq("id", id);

    if (error) throw error;

}
