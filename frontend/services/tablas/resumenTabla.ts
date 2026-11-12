// ==========================================================================
// resumenTabla.ts — cálculos PUROS (sin red ni Supabase) de la pantalla
// Reservas:
//   - ordenarPorSorteoActivo: orden de las tarjetas de precio (primero las
//     que tienen un sorteo activo; dentro de cada grupo, el orden original);
//   - calcularResumenTabla: el resumen de una tabla (totales por estado,
//     ocupación y recaudo del sorteo activo).
// Solo leen datos ya cargados; no cambian sorteos, reservas ni pagos.
// ==========================================================================

/**
 * Primero los precios con al menos un sorteo activo y después el resto,
 * sin cambiar el orden relativo dentro de cada grupo. Sin estado todavía
 * (entradas null), la lista queda como llegó.
 */
/**
 * Tarjetas de Reservas por VALOR numérico ascendente ($1.000 → $1.500 →
 * $2.000 → … → $15.000), nunca por texto. Orden estable: dos tablas del
 * mismo precio conservan su orden de llegada (creación) y siguen siendo dos
 * tarjetas distintas.
 */
export function ordenarPorPrecio<T extends { precio: number | string }>(lista: T[]): T[] {
    return lista
        .map((t, i) => ({ t, i, v: Number(String(t.precio).replace(/[^\d.-]/g, "")) }))
        .sort((a, b) => (a.v - b.v) || (a.i - b.i))
        .map(x => x.t);
}

export function ordenarPorSorteoActivo<T extends { entradas: { estado: string }[] | null }>(lista: T[]): T[] {
    const conActivo = (t: T) => Boolean(t.entradas?.some(e => e.estado === "activo"));
    return [...lista.filter(conActivo), ...lista.filter(t => !conActivo(t))];
}

export interface NumeroResumen {
    /** Estado efectivo del número (estadoVisual.estadoEfectivo). */
    estado: string;
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
}

/**
 * Resumen de una tabla con sus estados reales. Libres + reservados +
 * pagados = total. UNA TABLA = UN SORTEO: el recaudo son TODOS los números
 * pagados de la tabla × precio (la regla de importes del panel, como
 * GruposPanel), se pagaran por WhatsApp, a mano, desde cualquier grupo o
 * con otra identidad/evento en la fila; nunca reservas pendientes. Sin
 * sorteo activo del precio no se afirma ninguna cifra (null).
 */
export function calcularResumenTabla(
    numeros: NumeroResumen[],
    precio: number,
    sorteoActivo: { id: string } | null
): ResumenTabla {

    const total = numeros.length;
    const libres = numeros.filter(n => n.estado === "libre").length;
    const pagados = numeros.filter(n => n.estado === "pagado").length;
    const reservados = total - libres - pagados;

    const ocupacion = total > 0 ? Math.round(((total - libres) / total) * 100) : 0;

    return {
        total,
        libres,
        reservados,
        pagados,
        ocupacion,
        recaudo: sorteoActivo ? pagados * precio : null
    };

}
