import { supabase } from "@/lib/supabase";
import type { FilaArchivo, FilaAuditoria } from "@/components/tablas/historialDatos";

// Eventos fiables para «Historial de números» (solo lectura). Mismo filtro
// que obtenerActividad: tabla física + usuario de la sesión; la RLS de cada
// tabla (auth.uid() = usuario_id) es la barrera real.
//
// reservas_auditoria (032) y reservas_archivo (030) pueden no existir en el
// proyecto de Supabase: en ese caso se devuelve vacío y la pantalla lo dice,
// sin romper la tabla.

export const LIMITE_HISTORIAL = 1000;

const COLUMNAS_AUDITORIA = "id, origen, accion, numero, grupo_nombre, contacto_nombre, contacto_telefono, estado_anterior, estado_nuevo, motivo, observaciones, metodo_pago, resultado, codigo, operador_email, creado_en";

export interface EventosHistorial {
    auditoria: FilaAuditoria[];
    auditoriaDisponible: boolean;
    archivo: FilaArchivo[];
}

export async function obtenerEventosHistorial(tabla: string, usuarioId: string): Promise<EventosHistorial> {

    const [auditoria, archivo] = await Promise.all([

        supabase
            .from("reservas_auditoria")
            .select(COLUMNAS_AUDITORIA)
            .eq("usuario_id", usuarioId)
            .eq("tabla", tabla)
            .order("creado_en", { ascending: false })
            .limit(LIMITE_HISTORIAL),

        supabase
            .from("reservas_archivo")
            .select("id, numero, estado, nombre_evento, fila, motivo, archivado_en")
            .eq("usuario_id", usuarioId)
            .eq("tabla", tabla)
            .order("archivado_en", { ascending: false })
            .limit(LIMITE_HISTORIAL)

    ]);

    if (auditoria.error) console.warn("[historial] auditoría no disponible:", auditoria.error.message);
    if (archivo.error) console.warn("[historial] archivo no disponible:", archivo.error.message);

    return {
        auditoria: auditoria.error ? [] : ((auditoria.data || []) as FilaAuditoria[]),
        auditoriaDisponible: !auditoria.error,
        archivo: archivo.error ? [] : ((archivo.data || []) as FilaArchivo[])
    };

}
