// Llamada del SERVIDOR del panel al backend del bot, con límite de espera.
// Puro (sin Next): lo usa reenviarAlBot (lib/botApi.ts) y se prueba aparte.
//
// Nunca deja una petición colgada ni propaga una excepción:
//   - el bot no responde a tiempo  -> 504, code BOT_SIN_RESPUESTA
//   - el bot no es alcanzable      -> 502, code BOT_NO_DISPONIBLE
//   - responde algo que no es JSON -> su estado (o 502), code RESPUESTA_INVALIDA
//   - responde JSON                -> se devuelve tal cual, con su estado
//                                     (503 TOKEN_SERVICIO_NO_CONFIGURADO,
//                                     401, 404, 409... los decide el backend)
// El cuerpo de error trae los campos que ya leen los distintos llamadores
// del panel (success/ok/enviado, code/motivo, error). Nunca incluye
// cabeceras ni secretos.

export interface RespuestaBot {
    status: number;
    cuerpo: unknown;
}

export interface OpcionesLlamada {
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
}

export const TIMEOUT_BOT_MS = 15000;

function fallo(status: number, code: string, motivo: string, error: string): RespuestaBot {
    return { status, cuerpo: { success: false, ok: false, enviado: false, code, motivo, error } };
}

export async function llamarBot(url: string, init: RequestInit = {}, { timeoutMs = TIMEOUT_BOT_MS, fetchImpl = fetch }: OpcionesLlamada = {}): Promise<RespuestaBot> {

    let res: Response;

    try {
        res = await fetchImpl(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
        const nombre = (err as { name?: string } | null)?.name;
        return nombre === "TimeoutError" || nombre === "AbortError"
            ? fallo(504, "BOT_SIN_RESPUESTA", "backend_timeout", "El bot no respondió a tiempo.")
            : fallo(502, "BOT_NO_DISPONIBLE", "backend_no_disponible", "No se pudo contactar al bot.");
    }

    let texto = "";

    try {
        texto = await res.text();
    } catch (err) {
        const nombre = (err as { name?: string } | null)?.name;
        return nombre === "TimeoutError" || nombre === "AbortError"
            ? fallo(504, "BOT_SIN_RESPUESTA", "backend_timeout", "El bot no respondió a tiempo.")
            : fallo(502, "BOT_NO_DISPONIBLE", "backend_no_disponible", "No se pudo leer la respuesta del bot.");
    }

    // Cualquier JSON válido se devuelve tal cual (también null o un arreglo:
    // GET /sessions/active responde null cuando no hay sesión activa).
    let cuerpo: unknown;

    try {
        cuerpo = texto ? JSON.parse(texto) : {};
    } catch {
        return fallo(res.ok ? 502 : res.status, "RESPUESTA_INVALIDA", "respuesta_invalida", "El bot respondió en un formato inesperado.");
    }

    return { status: res.status, cuerpo };

}
