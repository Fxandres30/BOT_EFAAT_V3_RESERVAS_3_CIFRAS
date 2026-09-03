import { supabase } from "@/lib/supabase";
import { obtenerTablaConfig } from "@/lib/tablasConfig";
import { registrarActividad } from "./registrarActividad";

// Reinicia las 100 celdas (00-99) del usuario en la tabla física de este
// precio, dejándolas todas "libre". Solo toca filas con
// usuario_id = usuarioId — nunca las de otro tenant que comparta la misma
// tabla física.
export async function reiniciarTabla(precio: number, usuarioId: string) {

    const config = obtenerTablaConfig(precio);

    if (!config)
        throw new Error("Tabla no encontrada.");

    const { count, error: errorCount } = await supabase
        .from(config.tabla)
        .select("*", { count: "exact", head: true })
        .eq("usuario_id", usuarioId);

    if (errorCount)
        throw errorCount;

    // El usuario todavía no tiene su grilla creada: insertar 00-99.
    if ((count ?? 0) === 0) {

        const numeros = [];

        for (let i = 0; i < config.cantidad; i++) {

            numeros.push({
                numero: i.toString().padStart(2, "0"),
                estado: "libre",

                comprador: null,
                contacto: null,
                contacto_lower: null,

                lib: null,

                grupo_id: null,
                grupo_nombre: null,

                evento_id: null,
                nombre_evento: null,

                usuario_id: usuarioId,
                telefono_bot: null,

                fecha_reserva: null,
                hora_reserva: null,

                fecha_pago: null,
                hora_pago: null,

                temporal_por: null,
                bloqueado_hasta: null,

                ip_reserva: null

            });

        }

        const { error } = await supabase
            .from(config.tabla)
            .insert(numeros);

        if (error)
            throw error;

        await registrarActividad({
            usuarioId,
            tabla: config.tabla,
            tipo: "tabla_reiniciada",
            detalle: { precio, accion: "creada", filas: config.cantidad }
        });

        return true;
    }

    // Ya existe la grilla del usuario: reiniciar solo sus filas.
    const { error } = await supabase
        .from(config.tabla)
        .update({
            estado: "libre",

            comprador: null,
            contacto: null,
            contacto_lower: null,

            lib: null,

            grupo_id: null,
            grupo_nombre: null,

            evento_id: null,
            nombre_evento: null,

            telefono_bot: null,

            fecha_reserva: null,
            hora_reserva: null,

            fecha_pago: null,
            hora_pago: null,

            temporal_por: null,
            bloqueado_hasta: null,

            ip_reserva: null,

            usuario_global_id: null,
            nombre: null,
            telefono: null

        })
        .eq("usuario_id", usuarioId);

    if (error)
        throw error;

    await registrarActividad({
        usuarioId,
        tabla: config.tabla,
        tipo: "tabla_reiniciada",
        detalle: { precio, accion: "reiniciada", filas: count }
    });

    return true;
}
