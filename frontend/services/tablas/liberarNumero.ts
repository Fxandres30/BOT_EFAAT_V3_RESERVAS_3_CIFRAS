import { supabase } from "@/lib/supabase";
import { obtenerTablaConfig } from "@/lib/tablasConfig";
import { registrarActividad } from "./registrarActividad";

interface LiberarNumeroParams {
    precio: number;
    numero: string;
    usuarioId: string;
    realizadoPor?: string | null;
}

// Libera un número (cancela su reserva o pago) y lo devuelve a "libre".
// Operación destructiva: borra comprador/contacto/grupo/evento de la
// fila — el llamador debe confirmar con el usuario antes de invocarla.
export async function liberarNumero({
    precio,
    numero,
    usuarioId,
    realizadoPor
}: LiberarNumeroParams) {

    const config = obtenerTablaConfig(precio);

    if (!config)
        throw new Error("Tabla no encontrada.");

    const { data: filaAnterior, error: errorLectura } = await supabase
        .from(config.tabla)
        .select("*")
        .eq("numero", numero)
        .eq("usuario_id", usuarioId)
        .maybeSingle();

    if (errorLectura)
        throw errorLectura;

    if (!filaAnterior || filaAnterior.estado === "libre")
        throw new Error("El número ya está libre.");

    const estadoAnterior = filaAnterior.estado;

    const { data, error } = await supabase
        .from(config.tabla)
        .update({
            estado: "libre",
            comprador: null,
            contacto: null,
            contacto_lower: null,
            nombre: null,
            telefono: null,
            lib: null,
            grupo_id: null,
            grupo_nombre: null,
            evento_id: null,
            nombre_evento: null,
            fecha_reserva: null,
            hora_reserva: null,
            fecha_pago: null,
            hora_pago: null,
            temporal_por: null,
            bloqueado_hasta: null,
            usuario_global_id: null
        })
        .eq("numero", numero)
        .eq("usuario_id", usuarioId)
        .select()
        .maybeSingle();

    if (error)
        throw error;

    await registrarActividad({
        usuarioId,
        tabla: config.tabla,
        numero,
        eventoId: filaAnterior.evento_id,
        tipo: estadoAnterior === "pagado" ? "cancelado" : "liberado",
        detalle: {
            precio,
            estadoAnterior,
            comprador: filaAnterior.comprador,
            contacto: filaAnterior.contacto
        },
        realizadoPor
    });

    return data;

}
