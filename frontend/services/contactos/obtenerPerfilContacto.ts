import type { PerfilContacto } from "@/components/contactos/types";

// Proxy hacia GET /api/contactos/perfil -> backend GET /contactos/:id.
export async function obtenerPerfilContacto(
    contactoId: string,
    usuarioId: string
): Promise<PerfilContacto | null> {

    const res = await fetch(
        `/api/contactos/perfil?id=${encodeURIComponent(contactoId)}&usuarioId=${encodeURIComponent(usuarioId)}`
    );

    if (res.status === 404) return null;

    const data = await res.json();

    if (!res.ok || !data.success) {
        throw new Error(data.error || "No se pudo cargar el perfil del contacto.");
    }

    return {
        identidad: data.identidad,
        reservas: data.reservas,
        actividad: data.actividad,
        mensajes: data.mensajes
    } as PerfilContacto;

}
