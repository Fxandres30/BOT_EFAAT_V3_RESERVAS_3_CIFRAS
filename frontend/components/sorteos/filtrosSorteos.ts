// Dos modalidades de publicación sobre la MISMA programación del backend
// (sorteos_programados): «Programar sorteo» y «Publicar ahora». Un sorteo
// instantáneo lleva config.publicacion_inmediata = true; el resto se publica
// a su hora. Cada pantalla lista solo los suyos, sin duplicarlos.

export const esInstantaneo = (s: { config?: { publicacion_inmediata?: boolean } | null } | null | undefined): boolean =>
    s?.config?.publicacion_inmediata === true;

export function separarProgramaciones<T extends { config?: { publicacion_inmediata?: boolean } | null }>(lista: T[]) {
    return {
        programados: (lista || []).filter(s => !esInstantaneo(s)),
        instantaneos: (lista || []).filter(esInstantaneo)
    };
}
