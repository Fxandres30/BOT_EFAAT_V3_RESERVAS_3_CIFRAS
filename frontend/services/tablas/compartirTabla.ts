import { fetchConSesion } from "@/lib/fetchConSesion";

export interface ResultadoGrupo {
    grupo_id: string;
    nombre: string | null;
    estado: "enviado" | "ya_enviado" | "en_curso" | "fallido";
    error?: string;
}

export interface ResultadoCompartir {
    ok?: boolean;
    enviado: boolean;
    motivo?: string;
    aviso?: string;
    enviados?: number;
    fallidos?: number;
    resultados?: ResultadoGrupo[];
    invalidos?: string[];
}

export interface VistaPreviaCompartir {
    precio: number;
    evento: { id: string; nombre: string | null; hora_fin: string | null; hora_cierre: string | null };
    imagen: string | null;
    error_imagen: string | null;
    texto: string;
    origen_texto: "sorteo" | "habitual";
    grupos: { grupo_id: string; nombre: string | null }[];
    seleccion: string[];
    invalidos: string[];
    persistencia: boolean;
    sesion_conectada: boolean;
}

export interface EnvioCompartir {
    /** Uno por pulsación: reintentar la misma no reenvía a un grupo ya hecho. */
    solicitudId: string;
    /** Sin grupos: los guardados para esta tabla. */
    grupos?: string[];
    /** Texto editado para este envío; sin él, el configurado. */
    texto?: string;
    guardarDestinos?: boolean;
}

async function json<T>(res: Response): Promise<T> {
    try {
        return await res.json();
    } catch {
        return { ok: false, enviado: false, motivo: res.status === 504 ? "tiempo_agotado" : "error_interno" } as T;
    }
}

// Botón «Compartir»: la MISMA tubería del backend (services/compartirTabla.js:
// imagen real de la tabla + caption por Baileys) a los grupos elegidos.
export async function compartirTabla(precio: number, envio: EnvioCompartir): Promise<ResultadoCompartir> {

    const res = await fetchConSesion("/api/tablas/compartir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            precio,
            solicitudId: envio.solicitudId,
            ...(envio.grupos ? { grupos: envio.grupos } : {}),
            ...(envio.texto !== undefined ? { texto: envio.texto } : {}),
            ...(envio.guardarDestinos ? { guardar_destinos: true } : {})
        })
    });

    return json<ResultadoCompartir>(res);

}

export async function vistaPreviaCompartir(precio: number): Promise<{ ok: true; data: VistaPreviaCompartir } | { ok: false; motivo?: string }> {
    const res = await fetchConSesion(`/api/tablas/compartir/vista-previa?precio=${precio}`);
    return json(res);
}

export async function guardarDestinosCompartir(precio: number, grupos: string[]): Promise<{ ok: boolean; motivo?: string; invalidos?: string[] }> {
    const res = await fetchConSesion("/api/tablas/compartir/destinos", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ precio, grupos })
    });
    return json(res);
}

// Motivo del backend -> texto para el administrador.
export const MENSAJES_COMPARTIR: Record<string, string> = {
    sin_evento_activo: "No hay ningún sorteo activo en esta tabla para compartir.",
    tabla_no_configurada: "Esta tabla no está configurada.",
    sin_sesion_activa: "Tu WhatsApp no está conectado: conéctalo en Sesiones y vuelve a intentarlo. No se envió nada.",
    sin_destinos: "Todavía no has elegido los grupos de esta tabla.",
    destinos_no_disponibles: "Alguno de los grupos guardados ya no está disponible (quitado o desactivado). Elige los grupos de nuevo.",
    grupos_invalidos: "La selección de grupos no es válida.",
    envio_en_curso: "Ya se está compartiendo esta tabla. Espera a que termine.",
    error_imagen: "No se pudo generar la imagen de la tabla. No se envió nada.",
    tiempo_agotado: "El envío tardó demasiado en responder. Puede que se haya enviado: revisa los grupos antes de reintentar.",
    migracion_pendiente: "Guardar la selección de grupos todavía no está disponible."
};

export function mensajeCompartir(motivo?: string): string {
    return MENSAJES_COMPARTIR[motivo || ""] || "No se pudo compartir la tabla.";
}
