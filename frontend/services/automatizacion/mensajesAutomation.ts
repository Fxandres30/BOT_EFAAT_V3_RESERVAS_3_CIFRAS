import { supabase } from "@/lib/supabase";

// automation_messages — mismas columnas exactas de
// backend/supabase_migrations/007_automation_messages.sql.
export interface AutomationMessage {
    id: string;
    usuario_id: string | null; // null = global
    nombre_interno: string;
    texto: string;
    tipo: string;
    categoria: string | null;
    activo: boolean;
    orden: number;
    creado_en: string;
    actualizado_en: string;
}

export interface FiltrosMensajes {
    tipo?: string | null;
    categoria?: string | null;
    estado?: "todos" | "activos" | "inactivos";
}

// Junta GLOBALES (usuario_id is null) + PROPIOS del usuario autenticado —
// exactamente el mismo par que ya arma
// backend/automation/repo/messages.js:obtenerMensajesActivos(), solo que
// aquí se listan TODOS (activos e inactivos) para poder administrarlos,
// no solo los elegibles para enviar.
export async function listarMensajes(usuarioId: string, filtros: FiltrosMensajes = {}) {

    let query = supabase
        .from("automation_messages")
        .select("*")
        .or(`usuario_id.eq.${usuarioId},usuario_id.is.null`)
        .order("creado_en", { ascending: false });

    if (filtros.tipo) {
        query = query.eq("tipo", filtros.tipo);
    }

    if (filtros.categoria) {
        query = query.eq("categoria", filtros.categoria);
    }

    if (filtros.estado === "activos") {
        query = query.eq("activo", true);
    } else if (filtros.estado === "inactivos") {
        query = query.eq("activo", false);
    }

    return await query;

}

export interface DatosMensaje {
    nombre_interno: string;
    texto: string;
    tipo: string;
    categoria: string | null;
    activo: boolean;
}

// usuario_id SIEMPRE es el usuario autenticado real — la RLS de 007
// (`with check (auth.uid() = usuario_id)`) ya impide por diseño crear un
// mensaje global (usuario_id null) desde el cliente, así que ni hace
// falta un chequeo extra aquí: Postgres rechaza cualquier otro valor.
export async function crearMensaje(usuarioId: string, datos: DatosMensaje) {

    return await supabase
        .from("automation_messages")
        .insert({
            usuario_id: usuarioId,
            ...datos
        })
        .select()
        .single();

}

export async function actualizarMensaje(id: string, cambios: Partial<DatosMensaje>) {

    return await supabase
        .from("automation_messages")
        .update({
            ...cambios,
            actualizado_en: new Date().toISOString()
        })
        .eq("id", id)
        .select()
        .single();

}

export async function alternarActivo(id: string, activo: boolean) {

    return await actualizarMensaje(id, { activo });

}

// Duplicar SIEMPRE crea una copia PROPIA (incluso duplicando un mensaje
// global) — nunca otra copia global, mismo motivo que crearMensaje().
export async function duplicarMensaje(usuarioId: string, mensaje: AutomationMessage) {

    return await crearMensaje(usuarioId, {
        nombre_interno: `${mensaje.nombre_interno} (copia)`,
        texto: mensaje.texto,
        tipo: mensaje.tipo,
        categoria: mensaje.categoria,
        activo: mensaje.activo
    });

}

export async function eliminarMensaje(id: string) {

    return await supabase
        .from("automation_messages")
        .delete()
        .eq("id", id);

}
