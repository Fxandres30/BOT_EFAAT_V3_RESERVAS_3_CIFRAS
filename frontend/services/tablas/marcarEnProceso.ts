import { supabase } from "@/lib/supabase";
import { obtenerTablaConfig } from "@/lib/tablasConfig";
import { registrarActividad } from "./registrarActividad";

interface MarcarEnProcesoParams {
    precio: number;
    numero: string;
    usuarioId: string;
    minutos?: number;
    realizadoPor?: string | null;
}

// Pone un número libre "en proceso": una retención temporal (por ejemplo
// mientras se confirma un pago) que vence sola en `minutos`. A diferencia
// de bloquearNumero, esto siempre tiene fecha de vencimiento
// (bloqueado_hasta) — pasado ese momento el número vuelve a mostrarse
// disponible aunque nadie lo libere manualmente.
export async function marcarEnProceso({
    precio,
    numero,
    usuarioId,
    minutos = 10,
    realizadoPor
}: MarcarEnProcesoParams) {

    const config = obtenerTablaConfig(precio);

    if (!config)
        throw new Error("Tabla no encontrada.");

    const bloqueadoHasta = new Date(
        Date.now() + minutos * 60 * 1000
    ).toISOString();

    const { data, error } = await supabase
        .from(config.tabla)
        .update({
            estado: "en_proceso",
            temporal_por: realizadoPor || "panel",
            bloqueado_hasta: bloqueadoHasta
        })
        .eq("numero", numero)
        .eq("usuario_id", usuarioId)
        .eq("estado", "libre")
        .select()
        .maybeSingle();

    if (error)
        throw error;

    if (!data)
        throw new Error("Solo se puede poner en proceso un número que esté disponible.");

    await registrarActividad({
        usuarioId,
        tabla: config.tabla,
        numero,
        eventoId: data.evento_id,
        tipo: "bloqueado",
        detalle: { precio, tipoRetencion: "en_proceso", minutos, bloqueadoHasta },
        realizadoPor
    });

    return data;

}
