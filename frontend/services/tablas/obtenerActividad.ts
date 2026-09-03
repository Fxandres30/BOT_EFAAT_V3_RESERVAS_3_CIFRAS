import { supabase } from "@/lib/supabase";
import type { ActividadReserva } from "@/components/tablas/types";

// Últimos eventos reales registrados para una tabla física + usuario. Si
// la migración 002_reservas_actividad.sql todavía no se corrió en este
// proyecto de Supabase, la tabla no existe y se devuelve una lista vacía
// en vez de reventar la pantalla.
export async function obtenerActividad(
    tabla: string,
    usuarioId: string,
    limite = 15
): Promise<ActividadReserva[]> {

    const { data, error } = await supabase
        .from("reservas_actividad")
        .select("*")
        .eq("tabla", tabla)
        .eq("usuario_id", usuarioId)
        .order("creado_en", { ascending: false })
        .limit(limite);

    if (error) {
        console.error("No se pudo cargar actividad reciente:", error.message);
        return [];
    }

    return (data || []) as ActividadReserva[];

}
