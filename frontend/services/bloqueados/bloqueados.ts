import type { Bloqueado, ContextoExpulsion, DetalleExpulsiones, ResumenExpulsion } from "@/components/bloqueados/types";
import { fetchConSesion } from "@/lib/fetchConSesion";

// Fase "Bloqueo automático de WhatsApp" — YA funcional. Reemplaza la
// versión anterior (solo lectura directa a Supabase, tabla garantizada en
// 0 filas): ahora pasa por el backend (GET/POST /bloqueados), que es quien
// sabe resolver identidad, aplicar el bloqueo nativo de WhatsApp
// best-effort y mantener los contadores de intentos/expulsiones.

// Proxy hacia GET /api/bloqueados -> backend GET /bloqueados.
export async function listarBloqueados(usuarioId: string): Promise<Bloqueado[]> {

    const res = await fetchConSesion(`/api/bloqueados?usuarioId=${encodeURIComponent(usuarioId)}`);
    const data = await res.json();

    if (!res.ok || !data.success) {
        throw new Error(data.error || "No se pudo cargar la lista de bloqueados.");
    }

    return data.bloqueados as Bloqueado[];

}

export interface CrearBloqueoPayload {
    usuarioId: string;
    telefono?: string | null;
    lid?: string | null;
    jid?: string | null;
    nombre?: string | null;
    motivo?: string | null;
    bloqueadoPor?: string | null;
}

export interface ResultadoBloqueo {
    ok: boolean;
    motivo?: string;
    bloqueado?: Bloqueado;
    reactivado?: boolean;
    yaActivo?: boolean;
    // Bloquear: la expulsión queda programada (sigue en segundo plano).
    expulsion?: ResumenExpulsion & ContextoExpulsion & { programada: boolean; procesando: boolean; motivo: string | null };
    expulsionesCanceladas?: number;
}

// Estado de expulsión por grupo + historial — proxy hacia
// GET /api/bloqueados/expulsiones -> backend GET /bloqueados/:id/expulsiones.
export async function obtenerExpulsiones(id: string): Promise<DetalleExpulsiones> {

    const res = await fetchConSesion(`/api/bloqueados/expulsiones?id=${encodeURIComponent(id)}`);
    const data = await res.json();

    if (!res.ok || !data.ok) {
        throw new Error(data.error || "No se pudo consultar el estado de la expulsión.");
    }

    return data as DetalleExpulsiones;

}

// «Reintentar»: solo los grupos no resueltos — proxy hacia
// POST /api/bloqueados/reintentar -> backend POST /bloqueados/:id/reintentar.
export async function reintentarExpulsiones(id: string): Promise<{ ok: boolean; reprogramadas?: number; procesando?: boolean; motivo?: string }> {

    const res = await fetchConSesion("/api/bloqueados/reintentar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id })
    });

    return await res.json();

}

// "🚫 BLOQUEAR CONTACTO" — proxy hacia POST /api/bloqueados -> backend
// POST /bloqueados.
export async function crearBloqueo(payload: CrearBloqueoPayload): Promise<ResultadoBloqueo> {

    const res = await fetchConSesion("/api/bloqueados", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });

    return await res.json();

}

// "🔓 DESBLOQUEAR CONTACTO" — proxy hacia POST /api/bloqueados/desbloquear
// -> backend POST /bloqueados/:id/desbloquear.
export async function desbloquear(id: string, usuarioId: string): Promise<ResultadoBloqueo> {

    const res = await fetchConSesion("/api/bloqueados/desbloquear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, usuarioId })
    });

    return await res.json();

}

// Badge "🚫 CONTACTO BLOQUEADO" del detalle de contacto — proxy hacia
// GET /api/bloqueados/contacto -> backend GET /bloqueados/contacto.
export async function obtenerBloqueoDeContacto(
    usuarioId: string,
    { telefono, lid }: { telefono?: string | null; lid?: string | null }
): Promise<Bloqueado | null> {

    const params = new URLSearchParams({ usuarioId });
    if (telefono) params.set("telefono", telefono);
    if (lid) params.set("lid", lid);

    const res = await fetchConSesion(`/api/bloqueados/contacto?${params.toString()}`);
    const data = await res.json();

    if (!res.ok || !data.success) return null;

    return (data.bloqueado as Bloqueado | null) || null;

}
