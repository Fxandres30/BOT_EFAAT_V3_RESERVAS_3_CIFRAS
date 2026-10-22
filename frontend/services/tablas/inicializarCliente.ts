import { supabase } from "@/lib/supabase";
import { fetchConSesion } from "@/lib/fetchConSesion";
import { olvidarTablasCliente } from "./tablasCliente";

// Primer acceso del cliente al panel: el backend crea (idempotente) sus
// configuraciones de tablas y su cuadrícula 00-99 con el usuario del token.
// Una vez por pestaña y usuario; si falla (027 sin aplicar, backend caído…)
// el panel sigue con la configuración base y se reintenta en la próxima
// carga. Nunca bloquea la navegación. No envía ningún usuario: el backend
// solo cree al token.
const hechos = new Set<string>();

export async function inicializarCliente(): Promise<void> {

    const { data } = await supabase.auth.getSession();
    const usuarioId = data.session?.user?.id;

    if (!usuarioId || hechos.has(usuarioId)) return;
    hechos.add(usuarioId);

    try {
        const res = await fetchConSesion("/api/tablas/inicializar", { method: "POST" });
        const json = await res.json().catch(() => null);
        if (json?.ok) olvidarTablasCliente(usuarioId);
        else hechos.delete(usuarioId);
    } catch {
        hechos.delete(usuarioId);
    }

}
