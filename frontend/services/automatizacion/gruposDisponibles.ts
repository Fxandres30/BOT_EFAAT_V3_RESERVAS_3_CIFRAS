import { getSessions } from "@/services/sessions/getSessions";
import { fetchConSesion } from "@/lib/fetchConSesion";

// Grupos REALES de WhatsApp — Fase 4D, corregido tras auditoría (grupos
// fantasma/ausentes en /automatizacion/grupos).
//
// REGLA ABSOLUTA: la única fuente de verdad de "¿está esta sesión
// conectada ahora mismo?" es la respuesta REAL de
// /api/sessions/grupos-disponibles (que a su vez solo responde con éxito
// si backend/bot/controllers/sessionsController.js:gruposDisponibles()
// encontró un socket real vivo vía manager.get(id) y
// sock.groupFetchAllParticipating() funcionó).
//
// NUNCA se decide esto leyendo sesiones.estado (columna persistida en
// Supabase) — confirmado por auditoría que puede quedar desactualizada
// si el socket cae sin pasar por el flujo explícito de desconexión (una
// fila puede tener estado:"conectado" mientras GET /sessions/status/:id
// y manager.get(id) ya reportan que no hay socket real). Por eso este
// archivo YA NO filtra por estado antes de preguntar: se intenta el
// endpoint real para TODAS las sesiones del usuario, y el propio
// resultado de esa llamada (éxito o el error explícito "no tiene un
// socket conectado ahora mismo") es lo único que decide si esa sesión
// aporta grupos actuales. Si falla, esa sesión aporta CERO grupos — nunca
// se recurre a mensajes_grupos_sorteos, grupos_autorizados ni ningún otro
// dato histórico como reemplazo.
export interface GrupoDisponible {
    id: string;
    nombre: string;
}

export type EstadoConsultaGrupos = "conectada" | "desconectada" | "no_verificable";

// Clasifica la respuesta de /api/sessions/grupos-disponibles. Solo el 409
// del backend (sessionsController.gruposDisponibles: manager.get(id) sin
// socket) prueba que la sesión no tiene socket; 401/503 (token de
// servicio), 5xx o 502 (backend inalcanzable) solo dicen que no se pudo
// comprobar.
export function clasificarConsultaGrupos(status: number, exito: boolean): EstadoConsultaGrupos {

    if (exito) return "conectada";
    if (status === 409) return "desconectada";
    return "no_verificable";

}

export interface SesionConGrupos {
    sessionId: string;
    nombreSesion: string;
    telefono: string | null;
    // true SOLO si /api/sessions/grupos-disponibles confirmó un socket
    // real vivo para esta sesión en esta misma consulta — nunca inferido
    // de sesiones.estado.
    conectada: boolean;
    // Resultado de ESA consulta:
    //   conectada       el backend devolvió los grupos del socket vivo;
    //   desconectada    el backend respondió 409: no hay socket para ella;
    //   no_verificable  no se pudo preguntar (configuración, red o error
    //                   del servidor). NO significa que esté desconectada.
    estado: EstadoConsultaGrupos;
    grupos: GrupoDisponible[];
    error: string | null;
}

export async function obtenerGruposDisponibles(usuarioId: string): Promise<SesionConGrupos[]> {

    const { data: sesiones, error } = await getSessions(usuarioId);

    if (error || !sesiones) {
        return [];
    }

    const resultados = await Promise.all(

        sesiones.map(async (sesion: { id: string; nombre: string; telefono: string | null }) => {

            try {

                const res = await fetchConSesion(`/api/sessions/grupos-disponibles?id=${encodeURIComponent(sesion.id)}`);
                const data = await res.json().catch(() => ({ success: false }));
                const estado = clasificarConsultaGrupos(res.status, !!data.success);

                if (estado !== "conectada") {

                    // El motivo técnico va a la consola, nunca a la pantalla.
                    if (estado === "no_verificable") console.warn(`[grupos] no se pudo consultar la sesión ${sesion.id}: HTTP ${res.status}${data.code ? ` · ${data.code}` : ""}`);


                    // Incluye el caso explícito "La sesión ... no tiene un
                    // socket conectado ahora mismo" — esta sesión no
                    // aporta ningún grupo actual, punto. Nunca un
                    // fallback.
                    return {
                        sessionId: sesion.id,
                        nombreSesion: sesion.nombre,
                        telefono: sesion.telefono,
                        conectada: false,
                        estado,
                        grupos: [],
                        error: estado === "desconectada"
                            ? "Esta sesión no está conectada a WhatsApp ahora mismo."
                            : "No pudimos comprobar esta sesión en este momento."
                    };

                }

                return {
                    sessionId: sesion.id,
                    nombreSesion: sesion.nombre,
                    telefono: sesion.telefono,
                    conectada: true,
                    estado,
                    grupos: (data.grupos || []) as GrupoDisponible[],
                    error: null
                };

            } catch (err) {

                console.warn(`[grupos] error de red consultando la sesión ${sesion.id}:`, err);

                return {
                    sessionId: sesion.id,
                    nombreSesion: sesion.nombre,
                    telefono: sesion.telefono,
                    conectada: false,
                    estado: "no_verificable" as const,
                    grupos: [],
                    error: "No pudimos comprobar esta sesión en este momento."
                };

            }

        })

    );

    return resultados;

}
