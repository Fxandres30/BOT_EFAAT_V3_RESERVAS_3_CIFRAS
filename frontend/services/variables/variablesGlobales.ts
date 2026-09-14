import { supabase } from "@/lib/supabase";
import {
    FilaVariableGlobal,
    esIdentificadorValido,
    esVariableConocida,
    aplicarModificadorTexto
} from "@/services/mensajes/catalogoVariablesGlobal";

export type { FilaVariableGlobal };

export interface DatosVariableGlobal {
    identificador: string;
    nombre_visible: string;
    tipo: "concordancia" | "texto";
    singular?: string | null;
    plural?: string | null;
    valor?: string | null;
    categoria?: string;
    descripcion?: string;
    ejemplo?: string;
    activa?: boolean;
}

// Errores de VALIDACIÓN propia (antes de tocar Supabase) — nunca se le pide
// al usuario que interprete un error crudo de Postgres para estos casos.
export interface ErrorValidacion {
    message: string;
}

// "No crear duplicados silenciosos": rechaza un identificador que YA existe
// en el catálogo ESTÁTICO (clave, alias, o forma sufijada de gramática) —
// esa es la única validación que el código no puede delegar a la base de
// datos (Postgres no conoce el catálogo estático, que vive en JS). La
// colisión con OTRA variable dinámica del mismo usuario la resuelve el
// propio índice único (usuario_id, identificador) de la migración 017.
export function validarIdentificadorNuevo(identificador: string): ErrorValidacion | null {

    if (!identificador) {
        return { message: "El identificador es obligatorio." };
    }

    if (!esIdentificadorValido(identificador)) {
        return { message: "El identificador debe empezar con una letra minúscula y solo puede contener minúsculas, números y guion bajo (ej: suyo_suyos)." };
    }

    if (esVariableConocida(identificador)) {
        return { message: `"${identificador}" ya existe como variable del sistema — elige otro identificador.` };
    }

    return null;

}

export async function listarVariablesGlobales(usuarioId: string) {

    return supabase
        .from("variables_globales")
        .select("*")
        .eq("usuario_id", usuarioId)
        .order("created_at", { ascending: true });

}

// Solo las ACTIVAS — usado por el editor de plantillas para el catálogo
// unificado (autocomplete, validación, "Variables globales").
export async function listarVariablesActivas(usuarioId: string) {

    return supabase
        .from("variables_globales")
        .select("*")
        .eq("usuario_id", usuarioId)
        .eq("activa", true)
        .order("created_at", { ascending: true });

}

export async function crearVariableGlobal(usuarioId: string, datos: DatosVariableGlobal) {

    const errorValidacion = validarIdentificadorNuevo(datos.identificador);

    if (errorValidacion) {
        return { data: null, error: errorValidacion };
    }

    const { data, error } = await supabase
        .from("variables_globales")
        .insert({
            usuario_id: usuarioId,
            identificador: datos.identificador,
            nombre_visible: datos.nombre_visible,
            tipo: datos.tipo,
            singular: datos.singular ?? null,
            plural: datos.plural ?? null,
            valor: datos.valor ?? null,
            categoria: datos.categoria || "PERSONALIZADA",
            descripcion: datos.descripcion || "",
            ejemplo: datos.ejemplo || "",
            activa: datos.activa !== false
        })
        .select()
        .single();

    // Único caso transformado a un mensaje amigable: el choque esperado
    // contra unique(usuario_id, identificador) — la única restricción de
    // unicidad que tiene esta tabla, así que un 23505 aquí SIEMPRE es ese
    // conflicto. Cualquier otro código de error se devuelve tal cual, sin
    // ocultar nada.
    if (error && error.code === "23505") {
        return { data: null, error: { message: "Ya existe una variable global con ese identificador." } };
    }

    return { data, error };

}

// Editar NUNCA permite cambiar el identificador (evita romper plantillas
// que ya lo usan sin que el admin lo note) — solo nombre/tipo/singular/
// plural/valor/categoría/descripción/ejemplo/activa.
export async function actualizarVariableGlobal(
    id: string,
    usuarioId: string,
    cambios: Partial<Omit<DatosVariableGlobal, "identificador">>
) {

    return supabase
        .from("variables_globales")
        .update({
            ...cambios,
            updated_at: new Date().toISOString()
        })
        .eq("id", id)
        .eq("usuario_id", usuarioId)
        .select()
        .single();

}

export async function alternarActivaVariableGlobal(id: string, usuarioId: string, activa: boolean) {

    return supabase
        .from("variables_globales")
        .update({ activa, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("usuario_id", usuarioId)
        .select()
        .single();

}

export async function eliminarVariableGlobal(id: string, usuarioId: string) {

    return supabase
        .from("variables_globales")
        .delete()
        .eq("id", id)
        .eq("usuario_id", usuarioId);

}

// Cuenta cuántas plantillas del usuario mencionan {{identificador}} (con o
// sin modificador) — para la advertencia obligatoria antes de eliminar.
// Nunca elimina nada por su cuenta; solo informa.
export async function contarUsoEnPlantillas(usuarioId: string, identificador: string) {

    const { count, error } = await supabase
        .from("plantillas_mensaje")
        .select("id", { count: "exact", head: true })
        .eq("usuario_id", usuarioId)
        .ilike("contenido", `%{{${identificador}%`);

    return { count: count ?? 0, error };

}

// Sugiere un identificador libre para "Duplicar" — NUNCA inserta nada por
// su cuenta; el admin sigue pudiendo editarlo antes de guardar. Si
// "<original>_copia" también ya existiera (poco probable, pero posible si
// ya se duplicó antes), agrega un número hasta encontrar uno libre.
export function sugerirIdentificadorDuplicado(
    identificadorOriginal: string,
    identificadoresExistentes: string[]
): string {

    const existentes = new Set(identificadoresExistentes);
    let candidato = `${identificadorOriginal}_copia`;
    let intento = 2;

    while (existentes.has(candidato)) {
        candidato = `${identificadorOriginal}_copia_${intento}`;
        intento++;
    }

    return candidato;

}

// Prepara los datos de un DUPLICADO a partir de una fila existente — nunca
// sobrescribe la original (no toca Supabase; el llamador decide cuándo
// guardar el resultado, normalmente tras dejar que el admin edite el
// identificador sugerido en el formulario).
export function prepararDuplicado(
    original: FilaVariableGlobal,
    identificadoresExistentes: string[]
): DatosVariableGlobal {

    return {
        identificador: sugerirIdentificadorDuplicado(original.identificador, identificadoresExistentes),
        nombre_visible: `${original.nombre_visible} (copia)`,
        tipo: original.tipo,
        singular: original.singular,
        plural: original.plural,
        valor: original.valor,
        categoria: original.categoria,
        descripcion: original.descripcion,
        ejemplo: original.ejemplo,
        activa: true
    };

}

export interface ResultadoPrueba {
    resultado: string;
    detalle: string;
}

// "Probar variable" — determinístico, SIN datos reales de clientes, sin
// tocar Supabase. Mismo criterio de singular/plural que gramatica.js
// (cantidad === 1 -> singular; 0 o >=2 -> plural) y el mismo
// aplicarModificadorTexto que usa producción/preview.
export function probarVariable(
    datos: Pick<DatosVariableGlobal, "tipo" | "singular" | "plural" | "valor">,
    cantidad: number,
    modificador?: "lower" | "upper" | "capitalize" | "title"
): ResultadoPrueba {

    const base = datos.tipo === "concordancia"
        ? (Number(cantidad) === 1 ? (datos.singular || "") : (datos.plural || ""))
        : (datos.valor || "");

    return {
        resultado: aplicarModificadorTexto(base, modificador),
        detalle: datos.tipo === "concordancia"
            ? `cantidad=${cantidad} -> ${Number(cantidad) === 1 ? "singular" : "plural"}`
            : "valor fijo"
    };

}
