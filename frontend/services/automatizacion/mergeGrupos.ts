import type { SesionConGrupos } from "./gruposDisponibles";
import type { GrupoAutorizado } from "./gruposAutorizados";

// ==========================================================================
// mergearGrupos — REGLA DE IDENTIDAD ÚNICA del panel de Automatización.
//
// grupo_id (el JID de WhatsApp, ej. "120363421290339105@g.us") es la
// ÚNICA identidad de un grupo. Dos fuentes con el mismo grupo_id son
// SIEMPRE el mismo grupo — nunca dos tarjetas, nunca un match por nombre
// (el nombre puede cambiar; grupos_autorizados ni siquiera lo guarda).
//
// Antes de esta función, GruposAutomatizacion.tsx (y AutorizarGrupoModal)
// renderizaban:
//   1. una tarjeta POR SESIÓN para cada grupo de esa sesión — si el mismo
//      grupo_id aparecía en dos sesiones conectadas, salían DOS tarjetas
//      idénticas (nunca se deduplicaba entre sesiones).
//   2. una tarjeta aparte por cada fila de grupos_autorizados que no
//      calzara con `Set.has(grupo_id)` sobre los grupos ya listados en (1)
//      — una comparación de string EXACTA, sin normalizar espacios en
//      blanco. Un JID guardado con un espacio de más (p. ej. pegado a mano
//      en "+ Agregar por JID") nunca hacía match, así que ese grupo salía
//      OTRA VEZ como tarjeta "histórica", aunque estuviera conectado.
//
// Esta función es la ÚNICA fuente de la regla de fusión: agrupa TODO por
// grupo_id normalizado, colapsa cualquier duplicado entre sesiones, y solo
// adjunta el estado de autorización a la tarjeta ya existente — nunca crea
// una tarjeta nueva a partir de grupos_autorizados si el grupo YA está
// disponible por sesión.
// ==========================================================================

export interface SesionInfo {
    sessionId: string;
    nombreSesion: string;
}

export interface GrupoMergeado {
    grupoId: string;
    nombre: string;
    conectado: boolean; // true = visto AHORA en al menos una sesión conectada
    sesiones: SesionInfo[]; // todas las sesiones conectadas que lo reportan (vacío si no conectado)
    autorizacion: GrupoAutorizado | null; // null = nunca autorizado
}

// Normalización aplicada SOLO para decidir identidad/comparación (nunca
// se escribe de vuelta en Supabase): recortar espacios en blanco
// accidentales, y decodificar percent-encoding si lo hay — un JID real de
// WhatsApp NUNCA contiene "%" (ver bot/funciones/eventos/detectarEvento.js:
// siempre "<dígitos>[-<dígitos>]@g.us"), así que si aparece es porque se
// pegó una versión percent-encoded (p. ej. "120363421290339105%40g.us",
// copiada por error desde una URL del panel en vez del JID real) y debe
// compararse contra su forma real ("120363421290339105@g.us"), nunca
// tratarse como una identidad distinta. NUNCA se cambian mayúsculas/
// minúsculas ni se reescribe el JID de ninguna otra forma.
export function normalizarGrupoId(valor: string | null | undefined): string {

    const recortado = (valor || "").trim();

    if (!recortado) return recortado;

    try {
        return decodeURIComponent(recortado);
    } catch {
        // decodeURIComponent lanza ante un "%" suelto que no forma una
        // secuencia válida — se conserva el valor recortado tal cual en
        // vez de fallar la comparación completa.
        return recortado;
    }

}

export interface ResultadoMerge {
    disponibles: GrupoMergeado[]; // conectados AHORA — la lista principal
    historicos: GrupoMergeado[]; // autorizados antes, sin sesión conectada actual
}

export function mergearGrupos(
    sesiones: SesionConGrupos[],
    autorizados: GrupoAutorizado[]
): ResultadoMerge {

    const porGrupoId = new Map<string, GrupoMergeado>();

    // 1) Fuente PRIMARIA: sesiones de WhatsApp conectadas (Baileys, en
    //    vivo). Si el mismo grupo_id aparece en varias sesiones (o
    //    repetido dentro de la misma respuesta), se funde en UNA sola
    //    entrada — nunca una tarjeta por sesión.
    for (const sesion of sesiones) {

        for (const g of sesion.grupos) {

            const grupoId = normalizarGrupoId(g.id);

            if (!grupoId) continue;

            const existente = porGrupoId.get(grupoId);
            const sesionInfo: SesionInfo = { sessionId: sesion.sessionId, nombreSesion: sesion.nombreSesion };

            if (existente) {

                if (!existente.sesiones.some((s) => s.sessionId === sesion.sessionId)) {
                    existente.sesiones.push(sesionInfo);
                }

                // El nombre real más reciente gana — cualquier sesión que
                // lo reporte ve el mismo nombre actual de WhatsApp, así
                // que no importa cuál "escribe" primero.
                if (g.nombre) existente.nombre = g.nombre;

            } else {

                porGrupoId.set(grupoId, {
                    grupoId,
                    nombre: g.nombre || grupoId,
                    conectado: true,
                    sesiones: [sesionInfo],
                    autorizacion: null
                });

            }

        }

    }

    // 2) grupos_autorizados SOLO adjunta el estado de autorización a una
    //    tarjeta que YA EXISTE (match exclusivo por grupo_id) — nunca crea
    //    una tarjeta nueva ni un nombre inventado para un grupo que ya
    //    está disponible por sesión.
    const historicos: GrupoMergeado[] = [];
    const historicosVistos = new Set<string>();

    for (const auth of autorizados) {

        const grupoId = normalizarGrupoId(auth.grupo_id);

        if (!grupoId) continue;

        const existente = porGrupoId.get(grupoId);

        if (existente) {

            existente.autorizacion = auth;
            continue;

        }

        // Autorización histórica sin sesión conectada actual: nunca se
        // presenta como "disponible/conectado", nunca se inventa un
        // nombre — el llamador decide cómo mostrarlo (p. ej. con un
        // último nombre conocido de un historial aparte), pero esta
        // función nunca lo hace pasar por un grupo en vivo.
        if (!historicosVistos.has(grupoId)) {

            historicosVistos.add(grupoId);

            historicos.push({
                grupoId,
                nombre: grupoId,
                conectado: false,
                sesiones: [],
                autorizacion: auth
            });

        }

    }

    return {
        disponibles: [...porGrupoId.values()],
        historicos
    };

}
