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
 * ¿El número está ocupado (reservado/pagado) por un sorteo que NO es el
 * activo de la tabla? Se compara la identidad del sorteo, como el backend
 * (un sorteo en varios grupos tiene un evento por grupo y una identidad).
 * Sin sorteo activo, o sin datos para saberlo, se trata como de otro
 * sorteo: en un lote solo entra si el administrador lo incluye.
 */
export function esDeOtroSorteo(
    numero: { estado: string; identidad_evento_real?: string | null; evento_id?: string | null },
    activo: { id: string; identidad_evento_real?: string | null } | null
): boolean {
    if (numero.estado !== "reservado" && numero.estado !== "pagado") return false;
    if (!activo) return true;
    if (numero.identidad_evento_real && activo.identidad_evento_real) return numero.identidad_evento_real !== activo.identidad_evento_real;
    if (numero.evento_id) return numero.evento_id !== activo.id;
    return true;
}

/** Une la selección actual con `nuevos` sin repetir (orden de la tabla). */
export function anadirSeleccion(actual: string[], nuevos: string[]): string[] {
    return [...new Set([...actual, ...nuevos])].sort();
}
