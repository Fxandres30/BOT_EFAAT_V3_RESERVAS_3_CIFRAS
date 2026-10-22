import { supabase } from "@/lib/supabase";

// SEGURIDAD (2026-10-21): antes aceptaba `values: any` y el navegador podía
// cambiar usuario_id, activa, principal o estado de una sesión. El panel
// solo necesita renombrar (components/sessions/actions/renameSession.ts);
// conectar, activar, desconectar y eliminar van por el backend
// (/api/sessions/*, con la propiedad verificada). Cualquier otro campo se
// descarta aquí.
//
// La barrera real está en la base: docs/activacion/parte_d_sesiones_columnas.sql
// deja al rol authenticated actualizar SOLO la columna nombre.
export interface CambiosSesion {
    nombre: string;
}

export function soloCamposEditables(values: CambiosSesion): CambiosSesion {

    return { nombre: values.nombre };

}

export async function updateSession(

    id:string,

    values:CambiosSesion

){

    return await supabase

    .from("sesiones")

    .update(soloCamposEditables(values))

    .eq("id",id);

}
