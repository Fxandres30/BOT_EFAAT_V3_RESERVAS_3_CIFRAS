// Estado REAL de las sesiones (backend GET /sessions/salud): no solo si
// WhatsApp está conectado, sino si el bot está escuchando y procesando.
import { fetchConSesion } from "@/lib/fetchConSesion";

export type EstadoSalud =
    | "conectando"
    | "conectada"
    | "saludable"
    | "degradada"
    | "desconectada"
    | "conflicto_lease";

export interface SaludSesion {
    sessionId: string;
    estado: EstadoSalud;
    causas: string[];
    accion: string | null;
    escuchando?: boolean;
    conectadoEn: string | null;
    listenerEn: string | null;
    ultimoMensajeRecibidoEn: string | null;
    ultimoProcesadoOkEn: string | null;
    ultimoError: { mensaje: string; en: string } | null;
    erroresSeguidos: number;
    recuperaciones: { causa: string; en: string }[];
    lease: { ubicacion: string | null; propio: boolean; vigente: boolean; venceEn: string } | null;
}

export type ResultadoSalud =
    | { ok: true; instancia: string | null; generadoEn: string; sesiones: SaludSesion[] }
    | { ok: false; motivo: string };

export async function obtenerSaludSesiones(): Promise<ResultadoSalud> {

    try {

        const res = await fetchConSesion("/api/sessions/salud");
        const datos = await res.json().catch(() => null);

        if (!datos || typeof datos.ok !== "boolean") {
            return { ok: false, motivo: datos?.code || "respuesta_invalida" };
        }

        return datos as ResultadoSalud;

    } catch {

        return { ok: false, motivo: "backend_no_disponible" };

    }

}
