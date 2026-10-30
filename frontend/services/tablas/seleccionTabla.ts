// Ayudas de la selección múltiple de Tablas («Seleccionar»): qué números
// añadir con «Todos los libres» o con un rango. Módulo puro: solo decide
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

export type Rango = { ok: true; numeros: string[] } | { ok: false; mensaje: string };

/**
 * Números de la tabla entre `desde` y `hasta` (ambos incluidos, en
 * cualquier orden), con sus ceros iniciales tal como están en la tabla.
 * Solo dígitos; un extremo que no existe en la tabla se rechaza.
 */
export function numerosEnRango(numeros: Numero[], desde: string, hasta: string): Rango {

    const a = String(desde ?? "").trim();
    const b = String(hasta ?? "").trim();

    if (!/^\d+$/.test(a) || !/^\d+$/.test(b)) return { ok: false, mensaje: "Escribe dos números (solo dígitos)." };

    const [min, max] = [Number(a), Number(b)].sort((x, y) => x - y);
    const valores = numeros.map(n => Number(n.numero));
    if (!valores.includes(min) || !valores.includes(max)) return { ok: false, mensaje: "El rango debe estar dentro de la tabla." };

    return { ok: true, numeros: numeros.filter(n => Number(n.numero) >= min && Number(n.numero) <= max).map(n => n.numero).sort() };

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
