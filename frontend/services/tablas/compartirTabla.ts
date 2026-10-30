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

// Texto y grupos para «Compartir». La imagen NO viene de aquí: es la captura
// del `div` de la tabla visible (services/tablas/capturarTabla.ts).
export interface VistaPreviaCompartir {
    precio: number;
    evento: { id: string; nombre: string | null; hora_fin: string | null; hora_cierre: string | null };
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
    /** PNG (data URL) de la tabla visible, capturado al pulsar Compartir. */
    imagen: string;
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

// Botón «Compartir»: envía la captura de la tabla visible con su texto como
// caption a los grupos elegidos (backend: sendImage de Baileys).
export async function compartirTabla(precio: number, envio: EnvioCompartir): Promise<ResultadoCompartir> {

    const res = await fetchConSesion("/api/tablas/compartir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            precio,
            solicitudId: envio.solicitudId,
            imagen: envio.imagen,
            ...(envio.grupos ? { grupos: envio.grupos } : {}),
            ...(envio.texto !== undefined ? { texto: envio.texto } : {}),
            ...(envio.guardarDestinos ? { guardar_destinos: true } : {})
        })
    });

    return json<ResultadoCompartir>(res);

}

export async function vistaPreviaCompartir(precio: number): Promise<{ ok: true; data: VistaPreviaCompartir } | { ok: false; motivo?: string }> {
    // sin_imagen=1: la imagen es la captura del panel; el backend no la genera.
    const res = await fetchConSesion(`/api/tablas/compartir/vista-previa?precio=${precio}&sin_imagen=1`);
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
    imagen_invalida: "La imagen de la tabla no es válida o es demasiado grande. No se envió nada.",
    tiempo_agotado: "El envío tardó demasiado en responder. Puede que se haya enviado: revisa los grupos antes de reintentar.",
    sin_respuesta: "No llegó la respuesta del servidor (conexión interrumpida). Puede que se haya publicado en algún grupo: «Reintentar» repite la MISMA solicitud y no vuelve a enviar a los grupos ya hechos.",
    vista_previa_sin_respuesta: "No se pudo cargar la vista previa (sin conexión con el servidor). No se envió nada.",
    migracion_pendiente: "Guardar la selección de grupos todavía no está disponible."
};

export function mensajeCompartir(motivo?: string): string {
    return MENSAJES_COMPARTIR[motivo || ""] || "No se pudo compartir la tabla.";
}
