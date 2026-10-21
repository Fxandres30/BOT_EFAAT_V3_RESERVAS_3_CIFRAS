import { ejecutarAccionSesion, type ResultadoAccion } from "./accionSesion";

// Pide al bot que desconecte la sesión. Nunca lanza ni queda esperando:
// ver accionSesion.ts.
export function disconnectSession(sessionId: string): Promise<ResultadoAccion> {
    return ejecutarAccionSesion("/api/sessions/disconnect", sessionId);
}
