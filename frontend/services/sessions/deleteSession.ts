import { ejecutarAccionSesion, type ResultadoAccion } from "./accionSesion";

// Elimina una sesión propia a través del bot: desconecta WhatsApp, borra
// la fila y sus credenciales. Nunca lanza ni queda esperando: ver
// accionSesion.ts.
export function deleteSession(sessionId: string): Promise<ResultadoAccion> {
    return ejecutarAccionSesion("/api/sessions/eliminar", sessionId);
}
