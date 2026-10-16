import type { Contacto } from "@/components/contactos/types";
import { fetchConSesion } from "@/lib/fetchConSesion";

export interface ResultadoContactos {
    contactos: Contacto[];
    // true cuando el backend detecta que contactos_tenant todavía no existe
    // (falta aplicar supabase_migrations/018_contactos_tenant.sql).
    migracionPendiente: boolean;
}

// Texto para el cliente según la respuesta del backend: nunca detalles
// técnicos (token, servidor, base de datos). Esos van a la consola.
export function mensajeErrorContactos(status: number, codigo?: string): string {

    if (status === 401 && (codigo === "sin_sesion" || codigo === "sesion_invalida")) {
        return "Tu sesión expiró. Vuelve a iniciar sesión.";
    }

    return "No pudimos cargar los contactos en este momento. Siguen guardados; inténtalo de nuevo en unos minutos.";

}

// Proxy hacia GET /api/contactos -> backend GET /contactos. Mismo patrón
// que services/sessions/*.ts (fetch a la ruta interna de Next, nunca al
// backend directo desde el navegador).
export async function obtenerContactos(usuarioId: string): Promise<ResultadoContactos> {

    const res = await fetchConSesion(`/api/contactos?usuarioId=${encodeURIComponent(usuarioId)}`);

    const data = await res.json().catch(() => null);

    if (!res.ok || !data?.success) {
        const codigo = data?.code || data?.motivo;
        console.warn(`[contactos] no se pudieron cargar: HTTP ${res.status}${codigo ? ` · ${codigo}` : ""}`);
        throw new Error(mensajeErrorContactos(res.status, codigo));
    }

    return {
        contactos: (data.contactos || []) as Contacto[],
        migracionPendiente: !!data.migracionPendiente
    };

}
