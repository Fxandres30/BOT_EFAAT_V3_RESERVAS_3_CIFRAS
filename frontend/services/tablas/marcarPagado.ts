import { supabase } from "@/lib/supabase";
import { obtenerTablaConfig } from "@/lib/tablasConfig";
import { registrarActividad } from "./registrarActividad";

interface MarcarPagadoParams {
    precio: number;
    numero: string;
    usuarioId: string;
    realizadoPor?: string | null;
}

// Marca un número "reservado" como "pagado". Solo actúa sobre números que
// ya están reservados por este usuario — no se puede pagar un número
// libre ni tocar la fila de otro usuario_id.
export async function marcarPagado({
    precio,
    numero,
    usuarioId,
    realizadoPor
}: MarcarPagadoParams) {

    const config = obtenerTablaConfig(precio);

    if (!config)
        throw new Error("Tabla no encontrada.");

    const ahora = new Date();

    const fechaPago = ahora.toLocaleDateString("sv-SE", {
        timeZone: "America/Bogota"
    });

    const horaPago = ahora.toLocaleTimeString("es-CO", {
        hour12: false,
        timeZone: "America/Bogota"
    });

    const { data, error } = await supabase
        .from(config.tabla)
        .update({
            estado: "pagado",
            fecha_pago: fechaPago,
            hora_pago: horaPago
        })
        .eq("numero", numero)
        .eq("usuario_id", usuarioId)
        .eq("estado", "reservado")
        .select()
        .maybeSingle();

    if (error)
        throw error;

    if (!data)
        throw new Error("El número no está en estado 'reservado'.");

    await registrarActividad({
        usuarioId,
        tabla: config.tabla,
        numero,
        eventoId: data.evento_id,
        tipo: "pagado",
        detalle: {
            precio,
            comprador: data.comprador,
            contacto: data.contacto
        },
        realizadoPor
    });

    return data;

}
