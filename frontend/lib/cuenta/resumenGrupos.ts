import type { SesionConGrupos } from "@/services/automatizacion/gruposDisponibles";
import type { GrupoMergeado, ResultadoMerge } from "@/services/automatizacion/mergeGrupos";

// ==========================================================================
// «Mis grupos» — resumen de lo que el cliente usa, con la MISMA lógica que
// Automatización › Grupos:
//   - conexiones = filas de `sesiones` del usuario; si están conectadas lo
//     dice la consulta real al backend (gruposDisponibles.ts), nunca
//     sesiones.estado;
//   - grupos en uso = grupos_autorizados con activo = true, fusionados por
//     grupo_id con los grupos vivos de las sesiones (mergeGrupos.ts).
//
// Cupo CONTRATADO: no existe en la base ni en el backend (no hay tabla de
// suscripciones ni límite por cliente). Se devuelve null y la pantalla lo
// muestra como «no registrado»; nunca se deduce del catálogo de planes.
//
// Solo imports de tipos: tests/cuenta lo carga transpilado.
// ==========================================================================

export interface ResumenGrupos {
  conexiones: {
    total: number;
    conectadas: number;
    desconectadas: number;
    sinVerificar: number;
  };
  // Autorizados y activos, con nombre real si alguna sesión los ve ahora.
  enUso: GrupoMergeado[];
  // Autorizados pero pausados (activo = false).
  pausados: GrupoMergeado[];
  cupoContratado: number | null;
}

export function resumirGrupos(sesiones: SesionConGrupos[], merge: ResultadoMerge): ResumenGrupos {
  const autorizados = [...merge.disponibles, ...merge.historicos].filter((g) => g.autorizacion);

  return {
    conexiones: {
      total: sesiones.length,
      conectadas: sesiones.filter((s) => s.estado === "conectada").length,
      desconectadas: sesiones.filter((s) => s.estado === "desconectada").length,
      sinVerificar: sesiones.filter((s) => s.estado === "no_verificable").length
    },
    enUso: autorizados.filter((g) => g.autorizacion!.activo),
    pausados: autorizados.filter((g) => !g.autorizacion!.activo),
    cupoContratado: null
  };
}
