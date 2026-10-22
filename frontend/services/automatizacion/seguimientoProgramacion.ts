import { supabase } from "@/lib/supabase";

import type { AccionRegistrada } from "./estadoProgramacion";

// ==========================================================================
// Seguimiento real de Automatización → Programación (solo lectura).
//
// Lee con el cliente del panel (JWT del usuario, RLS), igual que
// estadisticas.ts y automationConfigs.ts — ningún endpoint nuevo:
//   - event_sessions / automation_actions: RLS "usuarios ven sus propios…"
//     (006_automation_engine.sql);
//   - eventos_bot / mensajes_grupos_sorteos: además se filtran por el
//     usuario de la sesión y por los grupos de SUS automation_configs.
// El usuarioId sale de supabase.auth (getUser), nunca de un parámetro.
// ==========================================================================

export interface EventoActivo {
    id: string;
    grupo_id: string;
    grupo_nombre: string | null;
    nombre_evento: string | null;
    fecha_evento: string | null;
    hora_cierre: string | null;
    hora_fin: string | null;
    activo: boolean | null;
    session_id: string | null;
    creado_en: string | null;
}

export interface CicloAutomatizacion {
    id: string;
    evento_id: string | null;
    grupo_id: string;
    session_id: string | null;
    estado: string;
    abierto_en: string | null;
    creado_en: string;
    datos_evento_snapshot: {
        nombre_evento?: string | null;
        hora_cierre?: string | null;
        fecha_evento?: string | null;
        grupo_nombre?: string | null;
    } | null;
}

export interface SeguimientoProgramacion {
    // grupo_id -> evento activo más reciente (eventos_bot.activo = true)
    eventos: Record<string, EventoActivo>;
    // grupo_id -> ciclo en curso más reciente (pendiente/abierto/cerrando)
    ciclos: Record<string, CicloAutomatizacion>;
    // event_session_id -> registros de automation_actions
    acciones: Record<string, AccionRegistrada[]>;
    // grupo_id -> último nombre registrado (eventos_bot o mensajes)
    nombres: Record<string, string>;
    // id de las sesiones del usuario marcadas como activas (sesiones.activa):
    // el Scheduler solo procesa los ciclos de la sesión activa. null = no
    // se pudo leer (no se afirma nada sobre ella).
    sesionesActivas: string[] | null;
}

const ESTADOS_EN_CURSO = ["pendiente", "abierto", "cerrando"];

function primeroPorGrupo<T extends { grupo_id: string }>(filas: T[]): Record<string, T> {

    const porGrupo: Record<string, T> = {};

    for (const fila of filas) {
        if (!porGrupo[fila.grupo_id]) porGrupo[fila.grupo_id] = fila;
    }

    return porGrupo;

}

export async function cargarSeguimiento(usuarioId: string, grupoIds: string[]): Promise<{ data: SeguimientoProgramacion | null; error: string | null }> {

    const vacio: SeguimientoProgramacion = { eventos: {}, ciclos: {}, acciones: {}, nombres: {}, sesionesActivas: [] };

    if (grupoIds.length === 0) return { data: vacio, error: null };

    const [eventosRes, ciclosRes, nombresRes, sesionesRes] = await Promise.all([

        supabase
            .from("eventos_bot")
            .select("id, grupo_id, grupo_nombre, nombre_evento, fecha_evento, hora_cierre, hora_fin, activo, session_id, creado_en")
            .eq("usuario_id", usuarioId)
            .in("grupo_id", grupoIds)
            .eq("activo", true)
            .order("creado_en", { ascending: false }),

        supabase
            .from("event_sessions")
            .select("id, evento_id, grupo_id, session_id, estado, abierto_en, creado_en, datos_evento_snapshot")
            .eq("usuario_id", usuarioId)
            .in("grupo_id", grupoIds)
            .in("estado", ESTADOS_EN_CURSO)
            .order("creado_en", { ascending: false }),

        // Último nombre conocido por grupo, aunque hoy no tenga evento.
        supabase
            .from("eventos_bot")
            .select("grupo_id, grupo_nombre, creado_en")
            .eq("usuario_id", usuarioId)
            .in("grupo_id", grupoIds)
            .not("grupo_nombre", "is", null)
            .order("creado_en", { ascending: false })
            .limit(500),

        supabase
            .from("sesiones")
            .select("id")
            .eq("usuario_id", usuarioId)
            .eq("activa", true)

    ]);

    const fallo = [eventosRes, ciclosRes].find((r) => r.error)?.error;

    if (fallo) {
        console.warn("[programacion] no se pudo leer el seguimiento:", fallo.message);
        return { data: null, error: "No pudimos consultar el estado de los eventos." };
    }

    const eventos = primeroPorGrupo((eventosRes.data || []) as EventoActivo[]);

    // El ciclo que vale es el del evento activo; si no calza, el más reciente.
    const todosCiclos = (ciclosRes.data || []) as CicloAutomatizacion[];
    const ciclos: Record<string, CicloAutomatizacion> = {};

    for (const grupoId of grupoIds) {

        const delGrupo = todosCiclos.filter((c) => c.grupo_id === grupoId);
        const evento = eventos[grupoId];

        const ciclo = (evento && delGrupo.find((c) => c.evento_id === evento.id)) || delGrupo[0];

        if (ciclo) ciclos[grupoId] = ciclo;

    }

    const cicloIds = Object.values(ciclos).map((c) => c.id);
    const acciones: Record<string, AccionRegistrada[]> = {};

    if (cicloIds.length > 0) {

        const accionesRes = await supabase
            .from("automation_actions")
            .select("id, event_session_id, tipo_accion, clave_idempotencia, estado, ejecutado_en, finalizado_en, detalle")
            .eq("usuario_id", usuarioId)
            .in("event_session_id", cicloIds)
            .order("ejecutado_en", { ascending: false });

        if (accionesRes.error) {
            console.warn("[programacion] no se pudieron leer los envíos:", accionesRes.error.message);
            return { data: null, error: "No pudimos consultar el historial de envíos." };
        }

        for (const accion of (accionesRes.data || []) as AccionRegistrada[]) {
            const clave = accion.event_session_id || "";
            (acciones[clave] ||= []).push(accion);
        }

    }

    const nombres: Record<string, string> = {};

    for (const fila of (nombresRes.data || []) as { grupo_id: string; grupo_nombre: string | null }[]) {
        if (fila.grupo_nombre && !nombres[fila.grupo_id]) nombres[fila.grupo_id] = fila.grupo_nombre;
    }

    // Respaldo: el último nombre visto en los mensajes de esos grupos.
    const sinNombre = grupoIds.filter((g) => !nombres[g]);

    if (sinNombre.length > 0) {

        const mensajesRes = await supabase
            .from("mensajes_grupos_sorteos")
            .select("grupo_id, grupo_nombre, timestamp_whatsapp")
            // Solo lo que recibió el bot de ESTE cliente (migración 028).
            .eq("cliente_usuario_id", usuarioId)
            .in("grupo_id", sinNombre)
            .not("grupo_nombre", "is", null)
            .order("timestamp_whatsapp", { ascending: false })
            .limit(200);

        for (const fila of (mensajesRes.data || []) as { grupo_id: string; grupo_nombre: string | null }[]) {
            if (fila.grupo_nombre && !nombres[fila.grupo_id]) nombres[fila.grupo_id] = fila.grupo_nombre;
        }

    }

    return {
        data: {
            eventos,
            ciclos,
            acciones,
            nombres,
            sesionesActivas: sesionesRes.error ? null : ((sesionesRes.data || []) as { id: string }[]).map((s) => s.id)
        },
        error: null
    };

}
