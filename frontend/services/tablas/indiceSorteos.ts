import { cargar, invalidar, leer } from "@/lib/cache/almacen";
import { apiSorteos, type SorteoActivo } from "@/services/sorteos/apiSorteos";
import type { ProgramacionTarjeta } from "@/services/tablas/estadoSorteoPrecio";

// Estado de los sorteos que muestra el índice de Reservas, en la caché común
// del panel (lib/cache/almacen.ts). Antes vivía en el useState del índice:
// al abrir una tabla el índice se desmontaba, el estado se perdía y al volver
// todas las tarjetas mostraban «Consultando sorteo…» hasta la nueva lectura.
//
// - Al volver se pinta lo último leído y se revalida en segundo plano.
// - Una fuente que falla conserva su último dato válido (nunca se inventa:
//   si nunca se leyó, sigue en null) y `fallo` lo dice.
// - Cualquier operación que modifica sorteos (POST/PUT/PATCH/DELETE de
//   apiSorteos) lo marca como no vigente (SUFIJO_INDICE_SORTEOS).

export interface FuentesIndice {
    activos: SorteoActivo[] | null;
    programados: ProgramacionTarjeta[] | null;
    /** true: la última lectura de alguna fuente falló (se muestra la anterior). */
    fallo: boolean;
}

export const SUFIJO_INDICE_SORTEOS = "|indiceSorteos";

// Mientras el índice no está montado no escucha Realtime: al volver se
// revalida SIEMPRE en segundo plano, salvo que la última lectura tenga menos
// de esto (dobles montajes, ida y vuelta inmediata) o ya haya una en curso.
// Realtime y el refresco periódico fuerzan lecturas aparte.
const VIGENCIA_MS = 5_000;

export const claveIndiceSorteos = (usuarioId: string) => `${usuarioId}${SUFIJO_INDICE_SORTEOS}`;

// Usuario de la última lectura: permite pintar la caché en el primer render
// (antes de resolver la sesión). Al cambiar de usuario la caché se vacía
// (lib/cache/sesion.ts), así que nunca se muestran datos de otra cuenta.
let ultimoUsuario: string | null = null;
export const ultimoUsuarioIndice = () => ultimoUsuario;

export function leerIndiceSorteos(usuarioId: string | null): FuentesIndice | undefined {
    return usuarioId ? leer<FuentesIndice>(claveIndiceSorteos(usuarioId)) : undefined;
}

export function cargarIndiceSorteos(usuarioId: string, { forzar = false } = {}): Promise<FuentesIndice> {

    ultimoUsuario = usuarioId;
    const clave = claveIndiceSorteos(usuarioId);

    return cargar<FuentesIndice>(clave, async () => {

        // Sorteos del usuario del token (el backend nunca recibe un id).
        const [activos, gestion] = await Promise.all([apiSorteos.activos(), apiSorteos.gestion()]);
        const programados = gestion.ok ? gestion : await apiSorteos.listar();

        const previo = leer<FuentesIndice>(clave);
        const fallo = !activos.ok || !programados.ok;

        const datos: FuentesIndice = {
            activos: activos.ok ? activos.data : previo?.activos ?? null,
            programados: programados.ok ? programados.data : previo?.programados ?? null,
            fallo
        };

        return datos;

    }, { forzar, vigenciaMs: VIGENCIA_MS }).then((datos) => {
        // Una lectura fallida no cuenta como vigente: la próxima vez se reintenta.
        if (datos.fallo) invalidar((c) => c === clave);
        return datos;
    });

}

export function olvidarIndiceSorteos() {
    invalidar((c) => c.endsWith(SUFIJO_INDICE_SORTEOS));
}
