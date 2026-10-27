import { supabase } from "@/lib/supabase";

// SEGURIDAD (2026-10-21): antes leía eventos_bot SIN filtrar, así que cada
// cliente veía los sorteos de todos. Ahora solo los del usuario de la
// sesión, que sale de Supabase Auth (getUser valida el token con el
// servidor), nunca de un parámetro. Sin sesión: nada.
//
// Este filtro no basta por sí solo (el navegador puede saltárselo): la
// barrera real es la RLS "panel lee sus eventos" de
// docs/activacion/propuesta_rls_tablas_antiguas.sql.
type ClienteEventos = Pick<typeof supabase, "from" | "auth">;

export async function obtenerEventos(cliente: ClienteEventos = supabase){

    const { data: sesion } = await cliente.auth.getUser();

    const usuarioId = sesion?.user?.id;

    if(!usuarioId){

        return[];

    }

    const {

        data,

        error

    }=await cliente

        .from("eventos_bot")

        .select("*")

        .eq("usuario_id",usuarioId)

        .order("fecha_evento",{

            ascending:false

        });

    if(error){

        console.log(error);

        return[];

    }

    // Eliminados desde «Administrar» (eliminación lógica, backend
    // sorteos/gestionEventos.js): se conservan en la base, no se muestran.
    return (data || []).filter((e: { estado?: string | null; cierre_motivo?: string | null }) =>
        e.estado !== "eliminado" && !String(e.cierre_motivo || "").startsWith("panel:eliminado"));

}
