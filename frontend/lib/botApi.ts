// Cabeceras para llamar al backend del bot desde las rutas API de Next
// (código de SERVIDOR únicamente).
//
// BOT_API_TOKEN no lleva el prefijo NEXT_PUBLIC_, así que Next nunca lo
// incluye en el bundle del navegador. Debe coincidir con SESSIONS_API_TOKEN
// del backend (ver backend/middleware/tokenServicio.js).
export function botApiHeaders(extra: Record<string, string> = {}): Record<string, string> {

    const token = process.env.BOT_API_TOKEN;

    return token ? { ...extra, "x-service-token": token } : { ...extra };

}
