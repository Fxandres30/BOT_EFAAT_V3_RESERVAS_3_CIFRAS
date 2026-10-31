// ==========================================================================
// resumenTabla.ts — cálculos PUROS (sin red ni Supabase) de la pantalla
// Reservas:
//   - ordenarPorSorteoActivo: orden de las tarjetas de precio (primero las
//     que tienen un sorteo activo; dentro de cada grupo, el orden original);
//   - calcularResumenTabla: el resumen de una tabla (totales por estado,
//     ocupación y recaudo del sorteo activo).
// Solo leen datos ya cargados; no cambian sorteos, reservas ni pagos.
// ==========================================================================

import { esDeOtroSorteo } from "./seleccionTabla";

/**
 * Primero los precios con al menos un sorteo activo y después el resto,
 * sin cambiar el orden relativo dentro de cada grupo. Sin estado todavía
 * (entradas null), la lista queda como llegó.
 */
export function ordenarPorSorteoActivo<T extends { entradas: { estado: string }[] | null }>(lista: T[]): T[] {
    const conActivo = (t: T) => Boolean(t.entradas?.some(e => e.estado === "activo"));
    return [...lista.filter(conActivo), ...lista.filter(t => !conActivo(t))];
}

export interface NumeroResumen {
    /** Estado efectivo del número (estadoVisual.estadoEfectivo). */
    estado: string;
    identidad_evento_real?: string | null;
    evento_id?: string | null;
}

export interface ResumenTabla {
    total: number;
    libres: number;
    /** Incluye «en proceso» y «bloqueado»: no están libres ni pagados. */
    reservados: number;
    pagados: number;
    /** % de números no libres (reservados + pagados), redondeado. */
    ocupacion: number;
    /** Dinero pagado del sorteo activo; null sin sorteo activo de este precio. */
    recaudo: number | null;
    /** Pagados del sorteo activo (los que suman al recaudo). */
    pagadosDelSorteo: number;
    /** Pagados que son de otro sorteo de la misma tabla física (no suman). */
    pagadosDeOtroSorteo: number;
}

/**
 * Resumen de una tabla con sus estados reales. Libres + reservados +
 * pagados = total. El recaudo usa la regla de importes del panel (números ×
 * precio de la tabla, como GruposPanel) y solo cuenta números PAGADOS del
 * sorteo activo de este precio: nunca reservas pendientes ni pagos de otro
 * sorteo. Sin sorteo activo del precio no se afirma ninguna cifra (null).
 */
export function calcularResumenTabla(
    numeros: NumeroResumen[],
    precio: number,
    sorteoActivo: { id: string; identidad_evento_real?: string | null } | null
): ResumenTabla {

    const total = numeros.length;
    const libres = numeros.filter(n => n.estado === "libre").length;
    const pagadosLista = numeros.filter(n => n.estado === "pagado");
    const pagados = pagadosLista.length;
    const reservados = total - libres - pagados;

    const ocupacion = total > 0 ? Math.round(((total - libres) / total) * 100) : 0;

    const pagadosDelSorteo = sorteoActivo
        ? pagadosLista.filter(n => !esDeOtroSorteo(n, sorteoActivo)).length
        : 0;

    return {
        total,
        libres,
        reservados,
        pagados,
        ocupacion,
        recaudo: sorteoActivo ? pagadosDelSorteo * precio : null,
        pagadosDelSorteo,
        pagadosDeOtroSorteo: sorteoActivo ? pagados - pagadosDelSorteo : 0
    };

}
