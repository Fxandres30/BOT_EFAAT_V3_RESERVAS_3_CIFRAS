import { supabase } from "@/lib/supabase";
import type { TablaConfiguracionVisual, TablaDisenoConfig } from "@/components/tablas/disenoTypes";

// Asignación de diseño ACTIVA de una tabla (usuario + precio). Cada fila
// es independiente: guardar la de $1.000 nunca toca la de $1.500 (unique
// (usuario_id, precio), sin relación entre filas de distintos precios).

export async function obtenerConfiguracionVisual(
    usuarioId: string,
    precio: number
): Promise<TablaConfiguracionVisual | null> {

    const { data, error } = await supabase
        .from("tabla_configuracion_visual")
        .select("*")
        .eq("usuario_id", usuarioId)
        .eq("precio", precio)
        .maybeSingle();

    if (error) throw error;

    return data as TablaConfiguracionVisual | null;

}

// Upsert por (usuario_id, precio): crea la fila la primera vez que el
// usuario personaliza esta tabla, o actualiza SOLO esta fila las
// siguientes — nunca crea/edita la de otro precio.
export async function guardarConfiguracionVisual(
    usuarioId: string,
    precio: number,
    config: TablaDisenoConfig,
    disenoOrigenId: string | null = null
): Promise<TablaConfiguracionVisual> {

    const { data, error } = await supabase
        .from("tabla_configuracion_visual")
        .upsert(
            {
                usuario_id: usuarioId,
                precio,
                config,
                diseno_origen_id: disenoOrigenId,
                actualizado_en: new Date().toISOString()
            },
            { onConflict: "usuario_id,precio" }
        )
        .select()
        .single();

    if (error) throw error;

    return data as TablaConfiguracionVisual;

}
