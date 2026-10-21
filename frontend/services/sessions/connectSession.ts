import { ejecutarAccionSesion, esSesionInexistente, type ResultadoAccion } from "./accionSesion";

// Pide al bot que conecte la sesión (muestra QR o reconecta). Nunca lanza
// ni queda esperando: ver accionSesion.ts.
export function connectSession(sessionId: string): Promise<ResultadoAccion> {
    return ejecutarAccionSesion("/api/sessions/connect", sessionId);
}

// La sesión ya no existe (fila eliminada o de otro usuario).
export function isSessionNotFound(res: ResultadoAccion): boolean {
    return esSesionInexistente(res);
}
