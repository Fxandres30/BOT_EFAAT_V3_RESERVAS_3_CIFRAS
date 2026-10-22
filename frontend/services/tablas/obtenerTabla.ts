import { supabase } from "@/lib/supabase";
import { PRECIOS_VALIDOS } from "@/lib/tablasConfig";
import { obtenerTablaConfigCliente } from "./tablasCliente";
import type { NumeroReserva } from "@/components/tablas/types";

export { PRECIOS_VALIDOS };

// Filas reales de la tabla física del usuario logueado, siempre las 100
// celdas (00-99) que le pertenecen — nunca las de otro usuario_id.
export async function obtenerTabla(
    precio: number,
    usuarioId: string
): Promise<NumeroReserva[]> {

    // Tabla física según la configuración DEL CLIENTE (tablas_cliente).
    const config = await obtenerTablaConfigCliente(precio, usuarioId);

    if (!config)
        throw new Error("Tabla no encontrada.");

    const { data, error } = await supabase
        .from(config.tabla)
        .select("*")
        .eq("usuario_id", usuarioId)
        .order("numero", { ascending: true });

    if (error)
        throw error;

    return (data || []) as NumeroReserva[];

}
