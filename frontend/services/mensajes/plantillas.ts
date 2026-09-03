import { supabase } from "@/lib/supabase";
import { obtenerPlantillasBase } from "./plantillasBase";
import { TIPOS_MENSAJE } from "./tiposMensaje";

export interface VariablesConfig {
    mostrar_nombre?: boolean;
    mostrar_evento?: boolean;
    mostrar_numeros_solicitados?: boolean;
    mostrar_numeros_reservados?: boolean;
    mostrar_numeros_ocupados?: boolean;
    mostrar_numeros_disponibles?: boolean;
    mostrar_fecha?: boolean;
    mostrar_hora?: boolean;
    mostrar_precio?: boolean;
    emojis?: boolean;
}

export interface PlantillaMensaje {
    id: string;
    usuario_id: string;
    tipo_respuesta: string;
    nombre: string;
    estilo: string;
    contenido: string;
    variables: VariablesConfig;
    habilitada: boolean;
    orden: number;
    created_at?: string;
    updated_at?: string;
}

export function valoresPorDefectoVariables(): VariablesConfig {
    return {
        mostrar_nombre: true,
        mostrar_evento: true,
        mostrar_numeros_solicitados: true,
        mostrar_numeros_reservados: true,
        mostrar_numeros_ocupados: true,
        mostrar_numeros_disponibles: true,
        mostrar_fecha: false,
        mostrar_hora: true,
        mostrar_precio: false,
        emojis: true
    };
}

export async function listarPlantillas(usuarioId: string, tipoRespuesta: string) {

    return await supabase
        .from("plantillas_mensaje")
        .select("*")
        .eq("usuario_id", usuarioId)
        .eq("tipo_respuesta", tipoRespuesta)
        .order("orden", { ascending: true });

}

export async function crearPlantilla(datos: Omit<PlantillaMensaje, "id" | "created_at" | "updated_at">) {

    return await supabase
        .from("plantillas_mensaje")
        .insert({
            ...datos,
            updated_at: new Date().toISOString()
        })
        .select()
        .single();

}

export async function crearPlantillaVacia(usuarioId: string, tipoRespuesta: string, orden: number) {

    return await crearPlantilla({
        usuario_id: usuarioId,
        tipo_respuesta: tipoRespuesta,
        nombre: "Nueva plantilla",
        estilo: "personalizada",
        contenido: "",
        variables: valoresPorDefectoVariables(),
        habilitada: true,
        orden
    });

}

export async function actualizarPlantilla(id: string, cambios: Partial<PlantillaMensaje>) {

    return await supabase
        .from("plantillas_mensaje")
        .update({
            ...cambios,
            updated_at: new Date().toISOString()
        })
        .eq("id", id)
        .select()
        .single();

}

export async function eliminarPlantilla(id: string) {

    return await supabase
        .from("plantillas_mensaje")
        .delete()
        .eq("id", id);

}

export async function duplicarPlantilla(plantilla: PlantillaMensaje) {

    return await crearPlantilla({
        usuario_id: plantilla.usuario_id,
        tipo_respuesta: plantilla.tipo_respuesta,
        nombre: `${plantilla.nombre} (copia)`,
        estilo: plantilla.estilo,
        contenido: plantilla.contenido,
        variables: plantilla.variables,
        habilitada: plantilla.habilitada,
        orden: plantilla.orden + 1
    });

}

// Ya NO existe "una sola activa": cada plantilla se habilita/deshabilita
// de forma independiente. El BOT decide cuál usar según el modo de
// selección configurado (ver configuracionSeleccion.ts).
export async function alternarHabilitada(id: string, habilitada: boolean) {

    return await supabase
        .from("plantillas_mensaje")
        .update({ habilitada, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single();

}

export interface ResultadoSemillado {
    yaInicializado: boolean;
    creadas: number;
    error?: string;
}

// Crea las plantillas iniciales de un tipo SOLO si el usuario todavía no
// tiene ninguna fila (habilitada o no) para ese tipo — esa es la
// condición de "ya inicializado". No reintenta si ya existen, aunque
// sean menos de 15 (p. ej. si el usuario ya personalizó y borró varias).
// Propaga cualquier error real (tabla inexistente, RLS, etc.) en vez de
// tragárselo — así la UI puede distinguir "0 porque ya se sembró y se
// vació a propósito" de "0 porque Supabase falló".
export async function sembrarPlantillasIniciales(usuarioId: string, tipoRespuesta: string): Promise<ResultadoSemillado> {

    const { data: existentes, error: errorLectura } = await listarPlantillas(usuarioId, tipoRespuesta);

    if (errorLectura) {
        return { yaInicializado: false, creadas: 0, error: errorLectura.message };
    }

    if (existentes && existentes.length > 0) {
        return { yaInicializado: true, creadas: 0 };
    }

    const base = obtenerPlantillasBase(tipoRespuesta);

    if (base.length === 0) {
        return { yaInicializado: false, creadas: 0 };
    }

    const filas = base.map((p, i) => ({
        usuario_id: usuarioId,
        tipo_respuesta: tipoRespuesta,
        nombre: p.nombre,
        estilo: p.estilo,
        contenido: p.contenido,
        variables: valoresPorDefectoVariables(),
        habilitada: true,
        orden: i,
        updated_at: new Date().toISOString()
    }));

    const { error } = await supabase
        .from("plantillas_mensaje")
        .insert(filas);

    if (error) {
        return { yaInicializado: false, creadas: 0, error: error.message };
    }

    return { yaInicializado: false, creadas: filas.length };

}

// Cuenta TODAS las plantillas del usuario, en TODOS los tipos — usada para
// decidir si corresponde la inicialización global (150 = 10 tipos x 15).
export async function contarTodasLasPlantillas(usuarioId: string) {

    return await supabase
        .from("plantillas_mensaje")
        .select("id", { count: "exact", head: true })
        .eq("usuario_id", usuarioId);

}

// Cuenta solo las habilitadas, en TODOS los tipos.
export async function contarHabilitadas(usuarioId: string) {

    return await supabase
        .from("plantillas_mensaje")
        .select("id", { count: "exact", head: true })
        .eq("usuario_id", usuarioId)
        .eq("habilitada", true);

}

export interface ResultadoSemilladoGlobal {
    tiposCreados: number;
    plantillasCreadas: number;
    errores: string[];
}

// Inicialización global: crea las 15 plantillas de CADA tipo soportado
// (10 x 15 = 150) sin que el usuario tenga que abrir cada tipo uno por
// uno. Reutiliza sembrarPlantillasIniciales() tipo por tipo — esa función
// ya garantiza no duplicar si un tipo puntual ya tiene filas, así que
// llamarla aquí para los 10 tipos es seguro incluso si algunos ya
// estaban inicializados. Quien decide SI llamar a esta función es
// MensajesPage, comprobando antes que el total real sea 0.
export async function sembrarTodosLosTiposIniciales(usuarioId: string): Promise<ResultadoSemilladoGlobal> {

    const tipos = TIPOS_MENSAJE.filter((t) => t.soportado);

    const resultados = await Promise.all(
        tipos.map((tipo) => sembrarPlantillasIniciales(usuarioId, tipo.id))
    );

    let tiposCreados = 0;
    let plantillasCreadas = 0;
    const errores: string[] = [];

    resultados.forEach((r, i) => {

        if (r.error) {
            errores.push(`${tipos[i].id}: ${r.error}`);
        } else if (r.creadas > 0) {
            tiposCreados++;
            plantillasCreadas += r.creadas;
        }

    });

    return { tiposCreados, plantillasCreadas, errores };

}
