// Estado REAL de la configuración de la cuenta para el catálogo de
// activadores — SOLO LECTURA. Reutiliza las lecturas que el panel ya hace
// (mismas tablas, mismo cliente Supabase con RLS por usuario); nunca
// escribe nada ni llama al backend del bot.
import { supabase } from "@/lib/supabase";
import { obtenerEstadosHabilitados } from "@/services/mensajes/configuracionSeleccion";
import { listarConfiguraciones, AutomationConfig } from "@/services/automatizacion/automationConfigs";
import { listarGruposAutorizados } from "@/services/automatizacion/gruposAutorizados";

export interface EstadoTipoRespuesta {
    habilitado: boolean;   // interruptor del tipo (sin fila = activado, igual que el backend)
    activas: number;
    total: number;
}

export interface EstadoAutomatizacion {
    gruposAutorizadosActivos: number;
    configuracionesActivas: number;
    // id de entrada del catálogo -> nº de grupos (con automatización
    // activada) que tienen esa función encendida.
    porFuncion: Record<string, number>;
}

export interface EstadoSticker {
    registrados: number;
    predeterminado: boolean;
}

export interface EstadoRealActivadores {
    tipos: Record<string, EstadoTipoRespuesta>;
    reaccionesActivadas: boolean;
    automatizacion: EstadoAutomatizacion | null;
    sticker: EstadoSticker | null;
    errores: string[];
}

const TIPO_REACCIONES = "reacciones_reserva";

// Qué campo de automation_configs enciende cada entrada del catálogo.
const FUNCION_AUTOMATIZACION: Record<string, (c: AutomationConfig) => boolean> = {
    "inicio-dia": (c) => c.mensaje_inicio_dia?.activo === true,
    apertura: (c) => c.mensaje_apertura?.activo === true,
    "tabla-inicial": (c) => c.publicacion_inicial_tabla?.activo === true,
    recordatorios: (c) => Object.values(c.recordatorios || {}).some((r) => r?.activo === true),
    actualizacion: (c) => c.mensaje_actualizacion?.activo === true,
    "mensaje-cierre": (c) => c.mensaje_cierre?.activo === true
};

export async function cargarEstadoRealActivadores(usuarioId: string): Promise<EstadoRealActivadores> {

    const errores: string[] = [];

    const [estados, plantillas, configs, grupos, stickers] = await Promise.all([
        obtenerEstadosHabilitados(usuarioId),
        supabase.from("plantillas_mensaje").select("tipo_respuesta, habilitada").eq("usuario_id", usuarioId),
        listarConfiguraciones(usuarioId),
        listarGruposAutorizados(usuarioId),
        supabase.from("configuracion_stickers_pago").select("grupo_id, sticker_sha256").eq("usuario_id", usuarioId)
    ]);

    const interruptores: Record<string, boolean> = {};

    if (estados.error) errores.push(`Interruptores: ${estados.error.message}`);

    (estados.data || []).forEach((fila: { tipo_respuesta: string; habilitada: boolean }) => {
        interruptores[fila.tipo_respuesta] = fila.habilitada;
    });

    const tipos: Record<string, EstadoTipoRespuesta> = {};

    if (plantillas.error) errores.push(`Plantillas: ${plantillas.error.message}`);

    (plantillas.data || []).forEach((p: { tipo_respuesta: string; habilitada: boolean }) => {
        const t = tipos[p.tipo_respuesta] ||= { habilitado: interruptores[p.tipo_respuesta] ?? true, activas: 0, total: 0 };
        t.total++;
        if (p.habilitada) t.activas++;
    });

    // Tipos con interruptor pero sin ninguna plantilla guardada.
    Object.entries(interruptores).forEach(([tipo, habilitado]) => {
        tipos[tipo] ||= { habilitado, activas: 0, total: 0 };
    });

    let automatizacion: EstadoAutomatizacion | null = null;

    if (configs.error || grupos.error) {
        errores.push(`Automatización: ${(configs.error || grupos.error)!.message}`);
    } else {
        const activas = (configs.data || []).filter((c: AutomationConfig) => c.activo === true);
        const porFuncion: Record<string, number> = {};
        Object.entries(FUNCION_AUTOMATIZACION).forEach(([id, encendida]) => {
            porFuncion[id] = activas.filter(encendida).length;
        });
        automatizacion = {
            gruposAutorizadosActivos: (grupos.data || []).filter((g: { activo: boolean }) => g.activo === true).length,
            configuracionesActivas: activas.length,
            porFuncion
        };
    }

    let sticker: EstadoSticker | null = null;

    if (stickers.error) {
        errores.push(`Sticker de pago: ${stickers.error.message}`);
    } else {
        const filas = (stickers.data || []) as { grupo_id: string | null; sticker_sha256: string | null }[];
        sticker = {
            registrados: filas.filter((f) => !!f.sticker_sha256).length,
            predeterminado: filas.some((f) => f.grupo_id === null && !!f.sticker_sha256)
        };
    }

    return {
        tipos,
        reaccionesActivadas: interruptores[TIPO_REACCIONES] ?? true,
        automatizacion,
        sticker,
        errores
    };

}

export function estadoDeTipo(estado: EstadoRealActivadores | null, tipo: string): EstadoTipoRespuesta {
    return estado?.tipos[tipo] || { habilitado: true, activas: 0, total: 0 };
}
