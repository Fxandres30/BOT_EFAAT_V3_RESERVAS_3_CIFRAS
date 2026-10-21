// Acciones del panel sobre una sesión de WhatsApp (conectar, desconectar,
// eliminar) a través de las rutas /api/sessions/* del panel.
//
// Nunca lanza y nunca queda esperando para siempre: cualquier resultado
// (éxito, error HTTP, error de red o tiempo agotado) vuelve como
// ResultadoAccion, con un mensaje claro para el usuario. Los mensajes no
// incluyen detalles técnicos ni secretos.
import { fetchConSesion } from "@/lib/fetchConSesion";

export type ResultadoAccion =
    | { ok: true; status: number; datos: unknown }
    | { ok: false; status: number; code: string; mensaje: string };

// Un poco más que el límite del proxy del panel (30 s para conectar): si el
// proxy responde 504, llega antes; esto cubre que el propio panel no responda.
export const TIMEOUT_ACCION_MS = 35000;

function leerCampo(datos: unknown, campo: string): string | null {
    if (!datos || typeof datos !== "object") return null;
    const valor = (datos as Record<string, unknown>)[campo];
    return typeof valor === "string" ? valor : null;
}

// Texto para el usuario según el error. Solo distingue lo que el usuario
// puede entender o resolver; nunca muestra valores de configuración.
export function mensajeErrorAccion(status: number, code: string): string {

    switch (code) {
        case "TOKEN_SERVICIO_NO_CONFIGURADO":
            return "El panel no puede comunicarse con el bot porque el servidor no está configurado. Avisa al soporte técnico.";
        case "NO_AUTORIZADO":
            return "El bot rechazó la comunicación con el panel por un problema de configuración del servidor. Avisa al soporte técnico.";
        case "sin_sesion":
        case "sesion_invalida":
            return "Tu sesión del panel expiró. Vuelve a iniciar sesión e inténtalo de nuevo.";
        case "SESSION_NOT_FOUND":
        case "NO_ENCONTRADA":
            return "Esta sesión ya no existe. Actualiza la lista de sesiones.";
        case "LEASE_NO_DISPONIBLE":
            return "Este número está funcionando en otro servidor del bot. Espera un minuto e inténtalo de nuevo.";
        case "FILA_NO_ELIMINADA":
            return "El número se desconectó, pero la sesión no se pudo eliminar. Inténtalo de nuevo.";
        case "AUTH_NO_ELIMINADO":
            return "La sesión se eliminó, pero sus archivos de conexión no se pudieron borrar. Avisa al soporte técnico.";
        case "BOT_SIN_RESPUESTA":
        case "TIEMPO_AGOTADO":
            return "El bot tardó demasiado en responder. Inténtalo de nuevo en un momento.";
        case "BOT_NO_DISPONIBLE":
            return "El bot no está disponible en este momento. Inténtalo de nuevo en unos minutos.";
        case "RED":
            return "No hay conexión con el panel. Revisa tu internet e inténtalo de nuevo.";
    }

    if (status === 401) return "Tu sesión del panel expiró. Vuelve a iniciar sesión e inténtalo de nuevo.";
    if (status === 404) return "Esta sesión ya no existe. Actualiza la lista de sesiones.";

    return `No se pudo completar la acción (error ${status}). Inténtalo de nuevo.`;

}

export async function ejecutarAccionSesion(
    ruta: string,
    sessionId: string,
    { timeoutMs = TIMEOUT_ACCION_MS, fetchImpl = fetchConSesion }: { timeoutMs?: number; fetchImpl?: typeof fetchConSesion } = {}
): Promise<ResultadoAccion> {

    let res: Response;

    try {
        res = await fetchImpl(ruta, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId }),
            signal: AbortSignal.timeout(timeoutMs)
        });
    } catch (err) {
        const nombre = (err as { name?: string } | null)?.name;
        const code = nombre === "TimeoutError" || nombre === "AbortError" ? "TIEMPO_AGOTADO" : "RED";
        return { ok: false, status: 0, code, mensaje: mensajeErrorAccion(0, code) };
    }

    const datos: unknown = await res.json().catch(() => null);

    // 200 con success:false (forma antigua del backend para algunos casos).
    const fallaLogica = res.ok && datos && typeof datos === "object" && (datos as Record<string, unknown>).success === false;

    if (res.ok && !fallaLogica) {
        return { ok: true, status: res.status, datos };
    }

    const code = leerCampo(datos, "code") || leerCampo(datos, "motivo") || (res.status === 404 ? "NO_ENCONTRADA" : `HTTP_${res.status}`);

    return { ok: false, status: res.status, code, mensaje: mensajeErrorAccion(res.status, code) };

}

export function esSesionInexistente(r: ResultadoAccion): boolean {
    return !r.ok && (r.code === "SESSION_NOT_FOUND" || r.code === "NO_ENCONTRADA" || r.status === 404);
}
