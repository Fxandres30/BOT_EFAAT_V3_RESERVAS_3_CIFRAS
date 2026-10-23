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

    // Reservas anticipadas (sorteo programado sin publicar): este reinicio no
    // las archiva, así que nunca las libera. Si hay alguna, no se reinicia;
    // además el UPDATE las excluye por si aparece una entre la lectura y la
    // escritura.
    const identidades = await identidadesSinPublicar(usuarioId);

    if (identidades.length) {

        const { data: anticipadas, error: errorAnticipadas } = await supabase
            .from(config.tabla)
            .select("numero")
            .eq("usuario_id", usuarioId)
            .in("identidad_evento_real", identidades)
            .neq("estado", "libre");

        if (errorAnticipadas)
            throw new Error("No se pudo comprobar si hay reservas anticipadas. No se reinició nada.");

        if ((anticipadas ?? []).length)
            throw new Error(`No se reinició la tabla: tiene ${anticipadas!.length} reserva(s) anticipada(s) de sorteos programados que todavía no se publicaron. Libéralas una a una o espera a que se publique el sorteo.`);

    }

    // Ya existe la grilla del usuario: reiniciar solo sus filas.
    let reinicio = supabase
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

    if (identidades.length)
        reinicio = reinicio.or(`identidad_evento_real.is.null,identidad_evento_real.not.in.(${identidades.join(",")})`);

    const { error } = await reinicio;

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

// Identidades de los sorteos programados del cliente que todavía no se
// publicaron (mismos estados que backend/sorteos/reservasAnticipadas.js).
// Sin la tabla de sorteos programados (migración 024 sin aplicar) no puede
// haber reservas anticipadas; cualquier otro error impide reiniciar.
const ESTADOS_SIN_PUBLICAR = ["borrador", "programado", "publicando", "fallido"];

async function identidadesSinPublicar(usuarioId: string): Promise<string[]> {

    const { data, error } = await supabase
        .from("sorteos_programados")
        .select("identidad_evento_real")
        .eq("usuario_id", usuarioId)
        .in("estado", ESTADOS_SIN_PUBLICAR);

    if (error) {
        if (error.code === "42P01" || error.code === "PGRST205") return [];
        throw new Error("No se pudo comprobar si hay reservas anticipadas. No se reinició nada.");
    }

    return [...new Set((data ?? []).map((s: { identidad_evento_real: string | null }) => s.identidad_evento_real).filter((x): x is string => Boolean(x)))];

}
