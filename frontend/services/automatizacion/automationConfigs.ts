import { supabase } from "@/lib/supabase";

// automation_configs — mismas columnas exactas de
// backend/supabase_migrations/006_automation_engine.sql (dias_permitidos,
// mensaje_apertura, mensaje_cierre, recordatorios, umbral_reservas,
// cooldown_minutos) + 008_automation_schedule.sql (mensaje_actualizacion).
// Este archivo no agrega ninguna columna ni tabla — cero migraciones
// nuevas.
export interface DiaPermitido {
    activo: boolean;
    desde: string; // "HH:mm"
    hasta: string; // "HH:mm"
}

export type DiasPermitidos = Record<string, DiaPermitido>;

// Fase 4B ya fijó esta forma en el backend (scheduler.js): el TEXTO real
// sale siempre del Message Pool (automation_messages), esta columna solo
// decide si está activo y con qué categoría.
export interface ConfigAccionSimple {
    activo: boolean;
    categoria: string | null;
}

export type ConfigRecordatorios = Record<string, ConfigAccionSimple>; // clave = minutos, ej. "60"

export interface AutomationConfig {
    id: string;
    usuario_id: string;
    grupo_id: string;
    activo: boolean;
    dias_permitidos: DiasPermitidos;
    mensaje_inicio_dia: Record<string, unknown>;
    mensaje_apertura: Record<string, unknown>;
    mensaje_cierre: ConfigAccionSimple;
    stickers: Record<string, unknown>;
    recordatorios: ConfigRecordatorios;
    mensaje_actualizacion: ConfigAccionSimple;
    umbral_reservas: number;
    cooldown_minutos: number;
    creado_en: string;
    actualizado_en: string;
}

export function configuracionPorDefecto(usuarioId: string, grupoId: string): Omit<AutomationConfig, "id" | "creado_en" | "actualizado_en"> {

    return {
        usuario_id: usuarioId,
        grupo_id: grupoId,
        activo: false,
        dias_permitidos: {},
        mensaje_inicio_dia: {},
        mensaje_apertura: {},
        mensaje_cierre: { activo: false, categoria: null },
        stickers: {},
        recordatorios: {
            "60": { activo: false, categoria: null },
            "30": { activo: false, categoria: null },
            "10": { activo: false, categoria: null }
        },
        mensaje_actualizacion: { activo: false, categoria: null },
        umbral_reservas: 10,
        cooldown_minutos: 20
    };

}

export async function obtenerConfiguracion(usuarioId: string, grupoId: string) {

    return await supabase
        .from("automation_configs")
        .select("*")
        .eq("usuario_id", usuarioId)
        .eq("grupo_id", grupoId)
        .maybeSingle();

}

export async function listarConfiguraciones(usuarioId: string) {

    return await supabase
        .from("automation_configs")
        .select("*")
        .eq("usuario_id", usuarioId);

}

// Upsert sobre unique(usuario_id, grupo_id) — funciona tanto para crear
// la primera configuración de un grupo recién autorizado como para
// guardar cambios sobre una ya existente, sin que la UI necesite saber
// cuál de los dos casos es.
export async function guardarConfiguracion(usuarioId: string, grupoId: string, cambios: Partial<AutomationConfig>) {

    return await supabase
        .from("automation_configs")
        .upsert(
            {
                usuario_id: usuarioId,
                grupo_id: grupoId,
                ...cambios,
                actualizado_en: new Date().toISOString()
            },
            { onConflict: "usuario_id,grupo_id" }
        )
        .select()
        .single();

}
