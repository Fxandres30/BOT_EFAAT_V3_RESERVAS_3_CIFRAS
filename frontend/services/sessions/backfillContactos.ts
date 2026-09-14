export interface ResultadoBackfillContactos {
    success: boolean;
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
// tenant/contacto para cada participante encontrado.
export async function backfillContactos(): Promise<ResultadoBackfillContactos> {

    const res = await fetch("/api/sessions/backfill-contactos", { method: "POST" });

    return await res.json();

}
