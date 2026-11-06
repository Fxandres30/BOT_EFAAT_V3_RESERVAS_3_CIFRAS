import { supabase } from "@/lib/supabase";

import type { AccionRegistrada } from "./estadoProgramacion";
import { calcularCierreReal } from "./estadoProgramacion";

// ==========================================================================
// Historial global de envíos de la automatización (solo lectura).
//
// automation_actions es el registro que escribe el ExecutionGuard: una
// fila por envío (o por omisión) con su clave de idempotencia. Se lee con
// el JWT del usuario (RLS «usuarios ven sus propias…», 006). Ningún dato se
// inventa: lo que no está registrado se devuelve como null y la interfaz
// lo muestra como «No registrado».
//   - Hora prevista: solo para recordatorios (cierre real − minutos), con la
//     fecha y hora de cierre del ciclo (snapshot) o, si faltan, del evento.
//   - Mensaje: el texto del pool que se usó (detalle.resultado.mensajeId).
// ==========================================================================

export interface EntradaHistorial extends AccionRegistrada {
    grupo_id: string;
    prevista: Date | null;
    mensaje: string | null;
}

export interface FiltrosHistorial {
    grupoId?: string | null;
    desde?: string | null; // "YYYY-MM-DD" (hora de Colombia)
    hasta?: string | null;
    limite?: number;
}

const LIMITE_DEFECTO = 300;

function inicioDiaColombia(fecha: string): string {
    return new Date(`${fecha}T00:00:00-05:00`).toISOString();
}

function finDiaColombia(fecha: string): string {
    return new Date(`${fecha}T23:59:59.999-05:00`).toISOString();
}

export async function listarHistorial(usuarioId: string, filtros: FiltrosHistorial = {}): Promise<{ data: EntradaHistorial[] | null; error: string | null; limite: number }> {

    const limite = filtros.limite || LIMITE_DEFECTO;

    let consulta = supabase
        .from("automation_actions")
        .select("id, event_session_id, grupo_id, tipo_accion, clave_idempotencia, estado, ejecutado_en, finalizado_en, detalle")
        .eq("usuario_id", usuarioId)
        .order("ejecutado_en", { ascending: false })
        .limit(limite);

    if (filtros.grupoId) consulta = consulta.eq("grupo_id", filtros.grupoId);
    if (filtros.desde) consulta = consulta.gte("ejecutado_en", inicioDiaColombia(filtros.desde));
    if (filtros.hasta) consulta = consulta.lte("ejecutado_en", finDiaColombia(filtros.hasta));

    const { data, error } = await consulta;

    if (error) {
        console.warn("[centro] no se pudo leer el historial:", error.message);
        return { data: null, error: "No pudimos consultar el historial de envíos.", limite };
    }

    const filas = (data || []) as (AccionRegistrada & { grupo_id: string })[];

    // Cierre de cada ciclo (para la hora prevista de los recordatorios).
    const cicloIds = [...new Set(filas.filter((f) => /^REMINDER_\d+M$/.test(f.tipo_accion) && f.event_session_id).map((f) => f.event_session_id as string))];
    const cierres = new Map<string, Date | null>();

    if (cicloIds.length > 0) {

        const ciclosRes = await supabase
            .from("event_sessions")
            .select("id, evento_id, datos_evento_snapshot")
            .eq("usuario_id", usuarioId)
            .in("id", cicloIds);

        const ciclos = (ciclosRes.data || []) as { id: string; evento_id: string | null; datos_evento_snapshot: { fecha_evento?: string | null; hora_cierre?: string | null } | null }[];

        const eventoIds = [...new Set(ciclos.map((c) => c.evento_id).filter(Boolean) as string[])];
        const eventos = new Map<string, { fecha_evento: string | null; hora_cierre: string | null }>();

        if (eventoIds.length > 0) {

            const eventosRes = await supabase
                .from("eventos_bot")
                .select("id, fecha_evento, hora_cierre")
                .eq("usuario_id", usuarioId)
                .in("id", eventoIds);

            for (const e of (eventosRes.data || []) as { id: string; fecha_evento: string | null; hora_cierre: string | null }[]) {
                eventos.set(e.id, e);
            }

        }

        for (const c of ciclos) {
            const evento = c.evento_id ? eventos.get(c.evento_id) : undefined;
            const fecha = c.datos_evento_snapshot?.fecha_evento || evento?.fecha_evento || null;
            const hora = c.datos_evento_snapshot?.hora_cierre || evento?.hora_cierre || null;
            cierres.set(c.id, calcularCierreReal(fecha, hora));
        }

    }

    // Texto del mensaje usado.
    const mensajeIds = [...new Set(filas.map((f) => idMensaje(f)).filter(Boolean) as string[])];
    const textos = new Map<string, string>();

    if (mensajeIds.length > 0) {

        const mensajesRes = await supabase
            .from("automation_messages")
            .select("id, texto")
            .in("id", mensajeIds);

        for (const m of (mensajesRes.data || []) as { id: string; texto: string }[]) textos.set(m.id, m.texto);

    }

    return {
        data: filas.map((f) => {

            const minutos = /^REMINDER_(\d+)M$/.exec(f.tipo_accion);
            const cierre = minutos && f.event_session_id ? cierres.get(f.event_session_id) || null : null;
            const mensajeId = idMensaje(f);

            return {
                ...f,
                prevista: cierre && minutos ? new Date(cierre.getTime() - Number(minutos[1]) * 60000) : null,
                mensaje: mensajeId ? textos.get(mensajeId) || null : null
            };

        }),
        error: null,
        limite
    };

}

function idMensaje(fila: AccionRegistrada): string | null {
    const resultado = (fila.detalle?.resultado ?? null) as Record<string, unknown> | null;
    return resultado && typeof resultado.mensajeId === "string" ? resultado.mensajeId : null;
}

// Envíos reales (no omitidos) de las últimas 24 h, para el resumen.
export async function contarEnviosRecientes(usuarioId: string, ahora: Date): Promise<number | null> {

    const { data, error } = await supabase
        .from("automation_actions")
        .select("estado, detalle")
        .eq("usuario_id", usuarioId)
        .eq("estado", "ok")
        .gte("ejecutado_en", new Date(ahora.getTime() - 24 * 3600 * 1000).toISOString())
        .limit(1000);

    if (error) return null;

    return ((data || []) as { detalle: Record<string, unknown> | null }[])
        .filter((f) => ((f.detalle?.resultado ?? null) as Record<string, unknown> | null)?.omitido !== true)
        .length;

}
