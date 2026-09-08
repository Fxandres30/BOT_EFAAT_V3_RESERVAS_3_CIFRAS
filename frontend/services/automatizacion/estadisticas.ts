import { supabase } from "@/lib/supabase";

export interface ResumenAutomatizacion {
    grupoAutorizadosActivos: number;
    grupoAutorizadosTotal: number;
    mensajesActivos: number;
    mensajesTotal: number;
    eventosActivos: number;
}

// Todos los conteos salen de una consulta real (count exact) — nunca un
// número inventado ni estimado. Si alguna consulta falla, esa cifra queda
// en 0 y el error se reporta aparte (la UI decide si mostrar el resumen
// parcial o el estado de error).
export async function obtenerResumenAutomatizacion(usuarioId: string): Promise<{ data: ResumenAutomatizacion | null; error: string | null }> {

    const [
        gruposActivosRes,
        gruposTotalRes,
        mensajesActivosRes,
        mensajesTotalRes,
        eventosActivosRes
    ] = await Promise.all([

        supabase
            .from("grupos_autorizados")
            .select("id", { count: "exact", head: true })
            .eq("usuario_id", usuarioId)
            .eq("activo", true),

        supabase
            .from("grupos_autorizados")
            .select("id", { count: "exact", head: true })
            .eq("usuario_id", usuarioId),

        // "Mensajes activos" del panel = los que el usuario puede llegar a
        // usar: globales + propios, activo=true — mismo criterio que
        // messageSelector.js (globales + propios).
        supabase
            .from("automation_messages")
            .select("id", { count: "exact", head: true })
            .or(`usuario_id.eq.${usuarioId},usuario_id.is.null`)
            .eq("activo", true),

        supabase
            .from("automation_messages")
            .select("id", { count: "exact", head: true })
            .or(`usuario_id.eq.${usuarioId},usuario_id.is.null`),

        // Mismos estados que ya usa
        // backend/automation/repo/eventSessions.js:obtenerAbiertas().
        supabase
            .from("event_sessions")
            .select("id", { count: "exact", head: true })
            .eq("usuario_id", usuarioId)
            .in("estado", ["abierto", "cerrando"])

    ]);

    const primerError = [gruposActivosRes, gruposTotalRes, mensajesActivosRes, mensajesTotalRes, eventosActivosRes]
        .find((r) => r.error)?.error;

    return {
        data: {
            grupoAutorizadosActivos: gruposActivosRes.count || 0,
            grupoAutorizadosTotal: gruposTotalRes.count || 0,
            mensajesActivos: mensajesActivosRes.count || 0,
            mensajesTotal: mensajesTotalRes.count || 0,
            eventosActivos: eventosActivosRes.count || 0
        },
        error: primerError ? primerError.message : null
    };

}
