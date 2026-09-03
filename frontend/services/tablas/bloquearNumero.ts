import { supabase } from "@/lib/supabase";
import { obtenerTablaConfig } from "@/lib/tablasConfig";
import { registrarActividad } from "./registrarActividad";

interface BloquearNumeroParams {
    precio: number;
    numero: string;
    usuarioId: string;
    motivo?: string;
    realizadoPor?: string | null;
}

// Bloquea manualmente un número libre de forma indefinida (por ejemplo:
// apartado por el organizador, número dañado/anulado). Distinto de
// marcarEnProceso: un bloqueo no tiene fecha de vencimiento y no se
// revierte solo. Solo se puede bloquear un número que esté libre.
export async function bloquearNumero({
    precio,
    numero,
    usuarioId,
    motivo,
    realizadoPor
}: BloquearNumeroParams) {

    const config = obtenerTablaConfig(precio);

    if (!config)
        throw new Error("Tabla no encontrada.");

    const { data, error } = await supabase
        .from(config.tabla)
        .update({
            estado: "bloqueado",
            temporal_por: motivo || realizadoPor || "bloqueo manual",
            bloqueado_hasta: null
        })
        .eq("numero", numero)
        .eq("usuario_id", usuarioId)
        .eq("estado", "libre")
        .select()
        .maybeSingle();

    if (error)
        throw error;

    if (!data)
        throw new Error("Solo se puede bloquear un número que esté disponible.");

    await registrarActividad({
        usuarioId,
        tabla: config.tabla,
        numero,
        eventoId: data.evento_id,
        tipo: "bloqueado",
        detalle: { precio, motivo: motivo || null },
        realizadoPor
    });

    return data;

}
