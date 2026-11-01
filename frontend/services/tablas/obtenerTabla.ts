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

// Solo los números indicados (tras una operación propia o un aviso
// incompleto): unas pocas filas en vez de la cuadrícula entera. La tabla
// física es la que ya resolvió la pantalla para este cliente.
export async function obtenerNumerosTabla(
    tabla: string,
    usuarioId: string,
    numeros: string[]
): Promise<NumeroReserva[]> {

    if (numeros.length === 0) return [];

    const { data, error } = await supabase
        .from(tabla)
        .select("*")
        .eq("usuario_id", usuarioId)
        .in("numero", numeros)
        .order("numero", { ascending: true });

    if (error)
        throw error;

    return (data || []) as NumeroReserva[];

}
