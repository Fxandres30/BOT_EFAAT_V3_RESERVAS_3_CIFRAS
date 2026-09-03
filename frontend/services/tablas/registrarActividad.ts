import { supabase } from "@/lib/supabase";
import type { TipoActividad } from "@/components/tablas/types";

interface RegistrarActividadParams {
    usuarioId: string;
    tabla: string;
    numero?: string | null;
    eventoId?: string | null;
    tipo: TipoActividad;
    detalle?: Record<string, unknown>;
    realizadoPor?: string | null;
}

// Inserta un registro en reservas_actividad. Nunca lanza: la actividad es
// un log de apoyo, no debe poder tumbar una acción real sobre la tabla si
// falla (por ejemplo si la migración 002 todavía no se ha corrido).
export async function registrarActividad({
    usuarioId,
    tabla,
    numero = null,
    eventoId = null,
    tipo,
    detalle = {},
    realizadoPor = null
}: RegistrarActividadParams): Promise<void> {

    const { error } = await supabase
        .from("reservas_actividad")
        .insert({
            usuario_id: usuarioId,
            tabla,
            numero,
            evento_id: eventoId,
            tipo,
            detalle,
            realizado_por: realizadoPor
        });

    if (error) {
        console.error("No se pudo registrar actividad:", error.message);
    }

}
