// Ayudas de la selección múltiple de Tablas («Seleccionar»): qué números
// añadir con «Todos los libres». Módulo puro: solo decide
// QUÉ se selecciona; las operaciones las valida el servidor.

import type { EstadoSeleccion } from "./pagoLote";

interface Numero {
    numero: string;
    estado: EstadoSeleccion;
}

/** Números libres de la tabla, en orden. */
export function numerosLibres(numeros: Numero[]): string[] {
    return numeros.filter(n => n.estado === "libre").map(n => n.numero).sort();
}

/**
 * ¿El número ocupado (reservado/pagado) queda fuera del sorteo activo de
 * este precio? UNA TABLA = UN SORTEO: con un sorteo activo del precio,
 * todos los números de la tabla son suyos, se reservaran desde el panel,
 * WhatsApp, cualquier grupo o «sin sorteo» (identidad y evento de la fila
 * son solo historia). Solo sin sorteo activo del precio (null) queda fuera:
 * en un lote entra si el administrador lo incluye. Misma regla que el
 * backend (reservaManual.deOtroSorteo).
 */
export function esDeOtroSorteo(
    numero: { estado: string },
    activo: { id: string } | null
): boolean {
    if (numero.estado !== "reservado" && numero.estado !== "pagado") return false;
    return !activo;
}

/** Une la selección actual con `nuevos` sin repetir (orden de la tabla). */
export function anadirSeleccion(actual: string[], nuevos: string[]): string[] {
    return [...new Set([...actual, ...nuevos])].sort();
}
