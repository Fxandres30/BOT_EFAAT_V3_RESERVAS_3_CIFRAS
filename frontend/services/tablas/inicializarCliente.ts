import { supabase } from "@/lib/supabase";
import { fetchConSesion } from "@/lib/fetchConSesion";
import { olvidarTablasCliente } from "./tablasCliente";

// Primer acceso del cliente al panel: el backend crea (idempotente) sus
// configuraciones de tablas y su cuadrícula 00-99 con el usuario del token.
// Una vez por pestaña y usuario; si falla (027 sin aplicar, backend caído…)
// el panel sigue con la configuración base y se reintenta pasados unos
// minutos (antes, en cada pantalla: una solicitud por navegación mientras
// fallara). Nunca bloquea la navegación. No envía ningún usuario: el
// backend solo cree al token.
const REINTENTO_MS = 5 * 60_000;
// usuario -> momento a partir del cual se puede volver a intentar.
const proximoIntento = new Map<string, number>();

export async function inicializarCliente(): Promise<void> {

    const { data } = await supabase.auth.getSession();
    const usuarioId = data.session?.user?.id;

    if (!usuarioId || (proximoIntento.get(usuarioId) ?? 0) > Date.now()) return;
    proximoIntento.set(usuarioId, Infinity);

    try {
        const res = await fetchConSesion("/api/tablas/inicializar", { method: "POST" });
        const json = await res.json().catch(() => null);
        if (json?.ok) olvidarTablasCliente(usuarioId);
        else proximoIntento.set(usuarioId, Date.now() + REINTENTO_MS);
    } catch {
        proximoIntento.set(usuarioId, Date.now() + REINTENTO_MS);
    }

}
