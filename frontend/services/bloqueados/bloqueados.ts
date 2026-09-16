import type { Bloqueado } from "@/components/bloqueados/types";

// Fase "Bloqueo automático de WhatsApp" — YA funcional. Reemplaza la
// versión anterior (solo lectura directa a Supabase, tabla garantizada en
// 0 filas): ahora pasa por el backend (GET/POST /bloqueados), que es quien
// sabe resolver identidad, aplicar el bloqueo nativo de WhatsApp
// best-effort y mantener los contadores de intentos/expulsiones.

// Proxy hacia GET /api/bloqueados -> backend GET /bloqueados.
export async function listarBloqueados(usuarioId: string): Promise<Bloqueado[]> {

    const res = await fetch(`/api/bloqueados?usuarioId=${encodeURIComponent(usuarioId)}`);
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
}

// "🚫 BLOQUEAR CONTACTO" — proxy hacia POST /api/bloqueados -> backend
// POST /bloqueados.
export async function crearBloqueo(payload: CrearBloqueoPayload): Promise<ResultadoBloqueo> {

    const res = await fetch("/api/bloqueados", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });

    return await res.json();

}

// "🔓 DESBLOQUEAR CONTACTO" — proxy hacia POST /api/bloqueados/desbloquear
// -> backend POST /bloqueados/:id/desbloquear.
export async function desbloquear(id: string, usuarioId: string): Promise<ResultadoBloqueo> {

    const res = await fetch("/api/bloqueados/desbloquear", {
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

    const res = await fetch(`/api/bloqueados/contacto?${params.toString()}`);
    const data = await res.json();

    if (!res.ok || !data.success) return null;

    return (data.bloqueado as Bloqueado | null) || null;

}
