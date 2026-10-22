import { supabase } from "@/lib/supabase";
import { obtenerTablaConfigCliente } from "./tablasCliente";
import { registrarActividad } from "./registrarActividad";
import { prepararCuadricula, diagnosticar } from "./prepararCuadricula";

// Reinicia las 100 celdas (00-99) del usuario en la tabla física de este
// precio, dejándolas todas "libre". Solo toca filas con
// usuario_id = usuarioId — nunca las de otro tenant que comparta la misma
// tabla física.
export async function reiniciarTabla(precio: number, usuarioId: string) {

    // Tabla física según la configuración DEL CLIENTE (tablas_cliente).
    const config = await obtenerTablaConfigCliente(precio, usuarioId);

    if (!config)
        throw new Error("Tabla no encontrada.");

    const { count, error: errorCount } = await supabase
        .from(config.tabla)
        .select("*", { count: "exact", head: true })
        .eq("usuario_id", usuarioId);

    if (errorCount)
        throw errorCount;

    // El panel no ve ninguna fila: puede que el cliente aún no tenga su
    // cuadrícula o que la base no deje leerla (RLS). El navegador ya no
    // inserta 00-99 por su cuenta (saltaba las guardias de la migración 027
    // y chocaba con UNIQUE(numero)): lo decide el backend con las filas
    // reales, sin tocar otra cuadrícula.
    if ((count ?? 0) === 0) {

        const r = await prepararCuadricula(precio);

        // Lo que la sesión ve ahora (si se acaba de crear, sus 100 filas).
        const { count: vistas } = await supabase
            .from(config.tabla)
            .select("*", { count: "exact", head: true })
            .eq("usuario_id", usuarioId);

        const d = diagnosticar(r, vistas ?? 0);

        if (d.tipo !== "lista")
            throw new Error(d.mensaje);

        await registrarActividad({
            usuarioId,
            tabla: config.tabla,
            tipo: "tabla_reiniciada",
            detalle: { precio, accion: "creada", filas: r.filas ?? config.cantidad }
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
