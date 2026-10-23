import { supabase } from "@/lib/supabase";

export type ModoSeleccion = "aleatorio" | "rotacion" | "fijo";

export interface ConfiguracionSeleccion {
    id: string;
    usuario_id: string;
    tipo_respuesta: string;
    modo_seleccion: ModoSeleccion;
    plantilla_fija_id: string | null;
    rotacion_indice: number;
    // Fase 5.5: ¿el BOT puede enviar respuestas de este tipo? NO controla
    // las plantillas (siguen existiendo/editables) ni el modo de
    // selección — es un concepto independiente de ambos.
    habilitada: boolean;
    created_at?: string;
    updated_at?: string;
}

export async function obtenerConfiguracionSeleccion(usuarioId: string, tipoRespuesta: string) {

    return await supabase
        .from("configuracion_seleccion_mensajes")
        .select("*")
        .eq("usuario_id", usuarioId)
        .eq("tipo_respuesta", tipoRespuesta)
        .maybeSingle();

}

// Fase 5.5: lee de una vez el estado (habilitado/desactivado) de TODOS
// los tipos del usuario — usado por el panel para pintar el interruptor
// de cada fila sin tener que abrir cada tipo uno por uno. Un tipo sin
// fila todavía en esta tabla no aparece aquí; el panel debe tratarlo como
// habilitado (mismo DEFAULT SEGURO que usa el backend en
// estaRespuestaHabilitada()).
export async function obtenerEstadosHabilitados(usuarioId: string) {

    return await supabase
        .from("configuracion_seleccion_mensajes")
        .select("tipo_respuesta, habilitada")
        .eq("usuario_id", usuarioId);

}

// Tipos retirados del panel que el bot sigue consultando con su propia
// fila: "mis_reservas" responde con «Mis números» solo si AMBAS filas
// están activas (backend/bot/handlers/eventHandler.js::
// interruptorPrevioHabilitado). Pulsar el interruptor visible guarda el
// mismo valor en la fila antigua; nunca se toca sin esa acción.
const INTERRUPTORES_VINCULADOS: Record<string, string[]> = {
    mis_numeros: ["mis_reservas"]
};

export function tiposDelInterruptor(tipoRespuesta: string): string[] {
    return [tipoRespuesta, ...(INTERRUPTORES_VINCULADOS[tipoRespuesta] ?? [])];
}

// Filas antiguas guardadas como desactivadas mientras el interruptor
// visible está activo (sin fila = activo, mismo DEFAULT SEGURO).
export function vinculadosDesactivados(tipoRespuesta: string, estados: Record<string, boolean>): string[] {

    if ((estados[tipoRespuesta] ?? true) === false) {
        return [];
    }

    return (INTERRUPTORES_VINCULADOS[tipoRespuesta] ?? []).filter((t) => estados[t] === false);

}

// Activa/desactiva un TIPO DE RESPUESTA completo (y sus vinculados, en
// la misma petición). upsert por (usuario_id, tipo_respuesta) — mismo
// unique constraint que usa guardarModoSeleccion. Al no incluir
// modo_seleccion/plantilla_fija_id/rotacion_indice, un upsert sobre una
// fila EXISTENTE nunca los toca (PostgREST solo actualiza las columnas
// enviadas); si la fila no existe todavía, se crea con los DEFAULT de la
// tabla (aleatorio, sin fija, 0).
export async function guardarTipoHabilitado(
    usuarioId: string,
    tipoRespuesta: string,
    habilitada: boolean
) {

    const ahora = new Date().toISOString();

    const { data, error } = await supabase
        .from("configuracion_seleccion_mensajes")
        .upsert(
            tiposDelInterruptor(tipoRespuesta).map((tipo) => ({
                usuario_id: usuarioId,
                tipo_respuesta: tipo,
                habilitada,
                updated_at: ahora
            })),
            { onConflict: "usuario_id,tipo_respuesta" }
        )
        .select();

    return {
        data: (data as ConfiguracionSeleccion[] | null)?.find((f) => f.tipo_respuesta === tipoRespuesta) ?? null,
        error
    };

}

// upsert por (usuario_id, tipo_respuesta) — unique constraint en la tabla.
export async function guardarModoSeleccion(
    usuarioId: string,
    tipoRespuesta: string,
    modoSeleccion: ModoSeleccion,
    plantillaFijaId: string | null
) {

    return await supabase
        .from("configuracion_seleccion_mensajes")
        .upsert(
            {
                usuario_id: usuarioId,
                tipo_respuesta: tipoRespuesta,
                modo_seleccion: modoSeleccion,
                plantilla_fija_id: modoSeleccion === "fijo" ? plantillaFijaId : null,
                updated_at: new Date().toISOString()
            },
            { onConflict: "usuario_id,tipo_respuesta" }
        )
        .select()
        .maybeSingle();

}
