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

// Lo registrado desde `desde` (incluido): para ponerse al día sin volver a
// descargar toda la actividad. A diferencia de obtenerActividad, un fallo
// se lanza: quien sincroniza decide reintentar.
export async function obtenerActividadDesde(
    tabla: string,
    usuarioId: string,
    desde: string,
    limite: number
): Promise<ActividadReserva[]> {

    const { data, error } = await supabase
        .from("reservas_actividad")
        .select("*")
        .eq("tabla", tabla)
        .eq("usuario_id", usuarioId)
        .gte("creado_en", desde)
        .order("creado_en", { ascending: false })
        .limit(limite);

    if (error)
        throw error;

    return (data || []) as ActividadReserva[];

}
