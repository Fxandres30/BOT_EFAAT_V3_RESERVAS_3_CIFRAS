import { supabase } from "@/lib/supabase";
import { DIAS_SEMANA } from "./tiposCategorias";

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

// backend/supabase_migrations/009_publicacion_inicial_tabla.sql — INITIAL_TABLE.
// Día/hora PROPIOS de esta acción (nunca la hora del sorteo, nunca
// dias_permitidos de Apertura, que ya no representa una restricción real,
// ver diasPermitidosSiempreAbierto() más abajo).
export type DiasSemanaBooleanos = Record<string, boolean>; // claves: lunes..domingo

export interface ConfigPublicacionInicialTabla {
    activo: boolean;
    hora: string; // "HH:mm"
    dias_permitidos: DiasSemanaBooleanos;
}

export interface AutomationConfig {
    id: string;
    usuario_id: string;
    grupo_id: string;
    activo: boolean;
    dias_permitidos: DiasPermitidos;
    mensaje_inicio_dia: Record<string, unknown>;
    mensaje_apertura: ConfigAccionSimple;
    mensaje_cierre: ConfigAccionSimple;
    stickers: Record<string, unknown>;
    recordatorios: ConfigRecordatorios;
    mensaje_actualizacion: ConfigAccionSimple;
    publicacion_inicial_tabla: ConfigPublicacionInicialTabla;
    umbral_reservas: number;
    cooldown_minutos: number;
    creado_en: string;
    actualizado_en: string;
}

// El panel YA NO permite configurar día/horario (esos datos son
// EXCLUSIVOS del evento real detectado — nunca de Automation, ver
// backend/supabase_migrations/006_automation_engine.sql, cabecera de
// automation_configs). Para no tener que tocar
// backend/automation/eventRules.js (evaluarApertura() rechaza si el día de
// hoy no está en dias_permitidos), se guarda siempre "abierto" los 7 días
// — así el único gate real que decide cuándo arranca un ciclo es el
// evento real detectado, no esta columna.
export function diasPermitidosSiempreAbierto(): DiasPermitidos {

    const dias: DiasPermitidos = {};

    for (const dia of DIAS_SEMANA) {
        dias[dia.id] = { activo: true, desde: "00:00", hasta: "23:59" };
    }

    return dias;

}

// Todos los días activos por defecto (igual criterio visual que el mockup
// del panel: "☑ Lunes ... ☑ Domingo") — el usuario los desmarca si quiere
// restringir. activo:false porque es una acción nueva, el usuario debe
// prenderla explícitamente (mismo criterio que recordatorios/actualización
// /cierre, a diferencia de apertura que ya venía activa antes de existir
// este toggle).
export function publicacionInicialTablaPorDefecto(): ConfigPublicacionInicialTabla {

    const dias: DiasSemanaBooleanos = {};

    for (const dia of DIAS_SEMANA) {
        dias[dia.id] = true;
    }

    return { activo: false, hora: "07:00", dias_permitidos: dias };

}

// Combina lo guardado con los defaults — una fila vieja (creada antes de
// que existiera esta columna) trae publicacion_inicial_tabla: {} (default
// jsonb de 009), y eso no debe renderizarse como "todo vacío/desmarcado"
// sino con los mismos valores por defecto que vería un grupo nuevo.
export function normalizarPublicacionInicialTabla(valor: Partial<ConfigPublicacionInicialTabla> | null | undefined): ConfigPublicacionInicialTabla {

    const base = publicacionInicialTablaPorDefecto();

    if (!valor) return base;

    return {
        activo: typeof valor.activo === "boolean" ? valor.activo : base.activo,
        hora: valor.hora || base.hora,
        dias_permitidos: {
            ...base.dias_permitidos,
            ...(valor.dias_permitidos || {})
        }
    };

}

export function configuracionPorDefecto(usuarioId: string, grupoId: string): Omit<AutomationConfig, "id" | "creado_en" | "actualizado_en"> {

    return {
        usuario_id: usuarioId,
        grupo_id: grupoId,
        activo: false,
        dias_permitidos: diasPermitidosSiempreAbierto(),
        mensaje_inicio_dia: {},
        mensaje_apertura: { activo: true, categoria: null },
        mensaje_cierre: { activo: false, categoria: null },
        stickers: {},
        recordatorios: {
            "60": { activo: false, categoria: null },
            "30": { activo: false, categoria: null },
            "10": { activo: false, categoria: null }
        },
        mensaje_actualizacion: { activo: false, categoria: null },
        publicacion_inicial_tabla: publicacionInicialTablaPorDefecto(),
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
