// "idle" = sin escaneo activo/terminado | "scanning" = leyendo Baileys |
// "syncing" = escribiendo en Supabase | "error" = el último escaneo falló |
// "sin_sesion" = no hay sesión activa conectada. Mismo vocabulario que
// backend/bot/funciones/usuarios/escanerIdentidadesLifecycle.js::obtenerEstadoIdentitySync
// — no se inventa un estado propio en el frontend.
export type EstadoEscaner = "idle" | "scanning" | "syncing" | "error" | "sin_sesion";

export interface ResultadoBackfillContactos {
    success: boolean;
    // true cuando la petición NO disparó un escaneo nuevo porque YA había
    // uno en curso — esto NO es un error funcional, es el estado esperado
    // si se pulsa el botón mientras el escaneo anterior sigue corriendo.
    yaEnCurso?: boolean;
    estado?: EstadoEscaner;
    mensaje?: string;
    error?: string;
    sessionId?: string;
    usuarioIdTenant?: string | null;
    estadisticas?: {
        gruposEncontrados: number;
        participantesAnalizados: number;
        lidsEncontrados: number;
        telefonosEncontrados: number;
        identidadesUnicasReconstruibles: number;
        conLidYTelefono: number;
        soloLid: number;
        soloTelefono: number;
        conflictos: number;
        duplicadosEvitados: number;
        excluidosPorSerElBot: number;
    };
    importado?: {
        nuevos: number;
        enriquecidos: number;
        conflictos: number;
        errores: number;
        total: number;
    };
}

// Dispara el backfill activo de Contactos: escanea AHORA todos los grupos
// de la sesión activa (Identity Scanner) y registra la relación
// tenant/contacto para cada participante encontrado. Si ya había un
// escaneo en curso, el backend responde 202 con yaEnCurso:true — esta
// función lo devuelve igual (success:true), nunca lo convierte en un throw.
export async function backfillContactos(): Promise<ResultadoBackfillContactos> {

    const res = await fetch("/api/sessions/backfill-contactos", { method: "POST" });

    return await res.json();

}

export interface ResultadoEstadoBackfill {
    success: boolean;
    sessionId: string | null;
    estado: EstadoEscaner;
}

// Solo lectura — para hacer polling del progreso sin volver a disparar el
// escaneo (a diferencia de backfillContactos()).
export async function obtenerEstadoBackfillContactos(): Promise<ResultadoEstadoBackfill> {

    const res = await fetch("/api/sessions/estado-backfill-contactos");

    return await res.json();

}
