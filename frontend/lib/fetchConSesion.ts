// fetch() del NAVEGADOR hacia las rutas /api del panel que llegan al backend
// del bot (sesiones, contactos, bloqueados, compartir tabla).
//
// Añade "Authorization: Bearer <access_token>" de la sesión de Supabase: el
// backend saca de ahí al usuario y comprueba que los datos sean suyos. Ya no
// se confía en un usuarioId enviado por el navegador.
import { supabase } from "@/lib/supabase";

export async function fetchConSesion(url: string, init: RequestInit = {}): Promise<Response> {

    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;

    const headers = new Headers(init.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);

    return fetch(url, { ...init, headers, cache: "no-store" });

}
