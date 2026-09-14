import type { Contacto } from "@/components/contactos/types";

export interface ResultadoContactos {
    contactos: Contacto[];
    // true cuando el backend detecta que contactos_tenant todavía no existe
    // (falta aplicar supabase_migrations/018_contactos_tenant.sql).
    migracionPendiente: boolean;
}

// Proxy hacia GET /api/contactos -> backend GET /contactos. Mismo patrón
// que services/sessions/*.ts (fetch a la ruta interna de Next, nunca al
// backend directo desde el navegador).
export async function obtenerContactos(usuarioId: string): Promise<ResultadoContactos> {

    const res = await fetch(`/api/contactos?usuarioId=${encodeURIComponent(usuarioId)}`);

    const data = await res.json();

    if (!res.ok || !data.success) {
        throw new Error(data.error || "No se pudieron cargar los contactos.");
    }

    return {
        contactos: (data.contactos || []) as Contacto[],
        migracionPendiente: !!data.migracionPendiente
    };

}
