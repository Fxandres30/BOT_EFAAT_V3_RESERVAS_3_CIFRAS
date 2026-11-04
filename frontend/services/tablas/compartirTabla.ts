import { fetchConSesion } from "@/lib/fetchConSesion";

export interface ResultadoGrupo {
    grupo_id: string;
    nombre: string | null;
    estado: "enviado" | "ya_enviado" | "en_curso" | "fallido";
    error?: string;
    /** Grupo nuevo de un sorteo del panel: true = el sorteo quedó ACTIVO ahí. */
    activado?: boolean;
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
    /** Envío aceptado (asincrono) o en curso (409 envio_en_curso). */
    operacion?: OperacionCompartir;
    /** Misma solicitud repetida: es la operación que ya existía. */
    repetida?: boolean;
    mensaje?: string | null;
}

// ------------------------------------------------ operaciones (04/11) ---
// Progreso REAL de un envío (backend/services/operacionesCompartir.js): cada
// estado viene de lo que de verdad pasó con WhatsApp en el servidor.

export type EstadoGrupoOperacion = "en_cola" | "preparando" | "enviando" | "enviado" | "error" | "cancelado";
export type EstadoOperacion = "en_curso" | "cancelando" | "completada" | "con_errores" | "cancelada" | "fallida";

export interface GrupoOperacion {
    grupo_id: string;
    nombre: string | null;
    /** activar = grupo nuevo del sorteo (se activa ahí y recibe el anuncio). */
    tipo: "compartir" | "activar";
    estado: EstadoGrupoOperacion;
    error: string | null;
    detalle?: string | null;
}

export interface OperacionCompartir {
    id: string;
    precio: number;
    estado: EstadoOperacion;
    /** Qué está haciendo ahora el servidor. */
    etapa: string;
    terminada: boolean;
    cancelacion_solicitada: boolean;
    aviso: string | null;
    mensaje_error: string | null;
    /** Instantánea del mensaje aprobado para ESTE envío. */
    mensaje: { texto: string; activo: boolean; revision: number | null; origen: string | null } | null;
    totales: { total: number; enviados: number; fallidos: number; cancelados: number; en_curso: number; pendientes: number; porcentaje: number };
    grupos: GrupoOperacion[];
}

// Texto y grupos para «Compartir». La imagen NO viene de aquí: es la captura
// del `div` de la tabla visible (services/tablas/capturarTabla.ts).
export interface VistaPreviaCompartir {
    precio: number;
    evento: { id: string; nombre: string | null; hora_fin: string | null; hora_cierre: string | null };
    texto: string;
    origen_texto: "sorteo" | "habitual";
    /** false: el mensaje del sorteo está desactivado (se envía solo la imagen). */
    texto_activo?: boolean;
    grupos: { grupo_id: string; nombre: string | null }[];
    seleccion: string[];
    invalidos: string[];
    persistencia: boolean;
    sesion_conectada: boolean;
    /** Sorteo del panel: la selección es la de SUS grupos (la misma de «Editar»). */
    sorteo_programado_id?: string | null;
    /** Estado del sorteo en cada grupo disponible (backend 04/11). */
    estado_grupos?: Record<string, "activo" | "pendiente" | "error" | "sin_sorteo">;
    /** Mensaje guardado (con {{variables}}) del que sale `texto`: la fuente única. */
    mensaje?: { plantilla: string | null; revision: number | null; fuente: "panel" | "detectado" | "habitual" | null; editable: boolean };
    /** Envío de esta tabla que sigue en curso (p. ej. tras cerrar la ventana). */
    operacion_activa?: OperacionCompartir | null;
}

/** Qué cambió al guardar los grupos de un sorteo del panel (no publica). */
export interface CambiosGruposTabla {
    seleccion: string[];
    agregados?: { grupo_id: string; nombre: string | null }[];
    quitados?: { grupo_id: string; nombre: string | null }[];
    desactivados?: { grupo_id: string; nombre: string | null }[];
    por_publicar?: number;
    avisos?: string[];
}

export interface EnvioCompartir {
    /** Uno por pulsación: reintentar la misma no reenvía a un grupo ya hecho. */
    solicitudId: string;
    /** PNG (data URL) de la tabla visible, capturado al pulsar Compartir. */
    imagen: string;
    /** Sin grupos: los guardados para esta tabla. */
    grupos?: string[];
    /** SOLO panel anterior: texto editado para un envío. El panel actual no
     *  lo manda: el texto es siempre el mensaje guardado del sorteo. */
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
            ...(envio.guardarDestinos ? { guardar_destinos: true } : {}),
            // Responde al aceptar (202 + operación); el progreso se consulta aparte.
            asincrono: true
        })
    });

    return json<ResultadoCompartir>(res);

}

export async function vistaPreviaCompartir(precio: number): Promise<{ ok: true; data: VistaPreviaCompartir } | { ok: false; motivo?: string }> {
    // sin_imagen=1: la imagen es la captura del panel; el backend no la genera.
    const res = await fetchConSesion(`/api/tablas/compartir/vista-previa?precio=${precio}&sin_imagen=1`);
    return json(res);
}

export async function guardarDestinosCompartir(precio: number, grupos: string[]): Promise<{ ok: boolean; motivo?: string; mensaje?: string | null; invalidos?: string[]; data?: CambiosGruposTabla }> {
    const res = await fetchConSesion("/api/tablas/compartir/destinos", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ precio, grupos })
    });
    return json(res);
}

export async function consultarOperacion(id: string): Promise<{ ok: true; data: OperacionCompartir } | { ok: false; motivo?: string }> {
    const res = await fetchConSesion(`/api/tablas/compartir/operaciones?id=${encodeURIComponent(id)}`);
    return json(res);
}

export async function operacionesDeTabla(precio: number): Promise<{ ok: true; data: { activa: OperacionCompartir | null; recientes: OperacionCompartir[] } } | { ok: false; motivo?: string }> {
    const res = await fetchConSesion(`/api/tablas/compartir/operaciones?precio=${precio}`);
    return json(res);
}

/** Idempotente: repetirla no cambia nada. Nunca retira lo ya publicado. */
export async function cancelarOperacion(id: string): Promise<{ ok: true; data: OperacionCompartir; ya_solicitada?: boolean; ya_terminada?: boolean } | { ok: false; motivo?: string }> {
    const res = await fetchConSesion("/api/tablas/compartir/operaciones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id })
    });
    return json(res);
}

export interface MensajeGuardado {
    texto: string;
    origen_texto: "sorteo" | "habitual";
    texto_activo: boolean;
    mensaje: NonNullable<VistaPreviaCompartir["mensaje"]>;
    aviso?: string | null;
}

/** Cambia EL mensaje de publicación del sorteo (el mismo de «Editar»). No envía nada. */
export async function guardarMensajeCompartir(precio: number, plantilla: string, basePlantilla: string): Promise<{ ok: true; data: MensajeGuardado } | { ok: false; motivo?: string; mensaje?: string | null; errores?: { campo: string; mensaje: string }[] | null }> {
    const res = await fetchConSesion("/api/tablas/compartir/mensaje", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ precio, plantilla, base_plantilla: basePlantilla })
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
    migracion_pendiente: "Guardar la selección de grupos todavía no está disponible.",
    texto_no_disponible: "No se pudo leer el mensaje del sorteo. No se envió nada: inténtalo de nuevo en unos segundos.",
    version_cambiada: "El mensaje del sorteo cambió desde que abriste esta ventana. Ciérrala y vuelve a abrirla para ver el actual.",
    no_encontrada: "No se encontró el envío: el servidor pudo reiniciarse. Lo ya enviado quedó registrado; «Reintentar» repite la MISMA solicitud y no duplica."
};

export function mensajeCompartir(motivo?: string): string {
    return MENSAJES_COMPARTIR[motivo || ""] || "No se pudo compartir la tabla.";
}
