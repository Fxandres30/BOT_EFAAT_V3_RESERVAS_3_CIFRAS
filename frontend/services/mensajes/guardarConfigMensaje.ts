import { supabase } from "@/lib/supabase";

export interface ConfigMensaje {

    usuario_id: string;
    tipo: string;

    activo: boolean;
    estilo: string;

    mensaje_inicial: string | null;
    mensaje_principal: string | null;
    mensaje_final: string | null;
    plantilla_personalizada: string | null;

    mostrar_nombre: boolean;
    mostrar_evento: boolean;
    mostrar_numeros_solicitados: boolean;
    mostrar_numeros_reservados: boolean;
    mostrar_numeros_ocupados: boolean;
    mostrar_numeros_disponibles: boolean;
    mostrar_fecha: boolean;
    mostrar_hora: boolean;
    mostrar_precio: boolean;

    emojis: boolean;

}

// upsert por (usuario_id, tipo) — la tabla tiene un unique constraint
// sobre ese par (ver supabase_migrations/001_configuracion_mensajes.sql).
export async function guardarConfigMensaje(config: ConfigMensaje) {

    return await supabase
        .from("configuracion_mensajes")
        .upsert(
            {
                ...config,
                actualizado_en: new Date().toISOString()
            },
            { onConflict: "usuario_id,tipo" }
        )
        .select()
        .maybeSingle();

}
