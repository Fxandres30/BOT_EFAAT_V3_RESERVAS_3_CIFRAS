// ==========================================================================
// services/loterias/seccionesCalendario.ts — estado plegado/desplegado de
// las dos secciones del calendario de loterías («Chances» y «Sorteos
// tradicionales»).
//
// Solo es una preferencia de vista: no toca loterías, horarios ni reglas.
// Se recuerda en sessionStorage, así que dura mientras el usuario navega en
// esa pestaña y vuelve a «todo desplegado» en una sesión nueva. Si el
// almacenamiento falla o tiene datos corruptos, ambas secciones se muestran
// desplegadas.
// ==========================================================================

export type CategoriaSeccion = "chance" | "tradicional";

/** true = desplegada. */
export type EstadoSecciones = Record<CategoriaSeccion, boolean>;

export const SECCIONES_INICIALES: EstadoSecciones = { chance: true, tradicional: true };

export const CLAVE_SECCIONES = "efaat:loterias:secciones:v1";

interface Almacen {
    getItem(clave: string): string | null;
    setItem(clave: string, valor: string): void;
}

export function leerSecciones(almacen: Almacen | null | undefined): EstadoSecciones {
    try {
        const crudo = almacen?.getItem(CLAVE_SECCIONES);
        if (!crudo) return { ...SECCIONES_INICIALES };
        const datos = JSON.parse(crudo) as Partial<Record<string, unknown>>;
        return {
            chance: typeof datos.chance === "boolean" ? datos.chance : true,
            tradicional: typeof datos.tradicional === "boolean" ? datos.tradicional : true
        };
    } catch {
        return { ...SECCIONES_INICIALES };
    }
}

export function guardarSecciones(almacen: Almacen | null | undefined, estado: EstadoSecciones): void {
    try {
        almacen?.setItem(CLAVE_SECCIONES, JSON.stringify({ chance: estado.chance, tradicional: estado.tradicional }));
    } catch {
        // Almacenamiento bloqueado: el estado vive solo en memoria.
    }
}

/** Pliega o despliega UNA sección; la otra no cambia. */
export function alternarSeccion(estado: EstadoSecciones, categoria: CategoriaSeccion): EstadoSecciones {
    return { ...estado, [categoria]: !estado[categoria] };
}

/**
 * Al buscar: despliega las secciones plegadas que tienen resultados para que
 * se vean. Las que no tienen resultados quedan como estaban. Sin búsqueda no
 * cambia nada.
 */
export function desplegarConResultados(
    estado: EstadoSecciones,
    busqueda: string,
    resultados: Record<CategoriaSeccion, number>
): EstadoSecciones {
    if (!busqueda.trim()) return estado;
    const siguiente = { ...estado };
    for (const c of ["chance", "tradicional"] as const) {
        if (!siguiente[c] && resultados[c] > 0) siguiente[c] = true;
    }
    return siguiente.chance === estado.chance && siguiente.tradicional === estado.tradicional ? estado : siguiente;
}
