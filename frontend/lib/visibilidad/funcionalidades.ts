// ==========================================================================
// VISIBILIDAD DE FUNCIONALIDADES (fuente única).
//
// Decide SOLO si una funcionalidad se MUESTRA en la interfaz. No borra,
// no desactiva y no protege nada: componentes, rutas (/lector-pagos,
// /bloqueados), servicios, endpoints, datos y lógica de negocio siguen
// intactos y funcionando. Una ruta oculta sigue abriéndose si se escribe
// su dirección.
//
// Para volver a mostrar una funcionalidad: cambiar su `visible` a true y
// actualizar docs/FEATURE_VISIBILITY_REGISTER.md y docs/LAUNCH_VISIBILITY.md.
// Para ocultar una nueva: añadir su id aquí, marcar el punto de la interfaz
// con esVisible(id) (o `funcionalidad` en el menú) y registrarla en ambos
// documentos. No poner condiciones de visibilidad sueltas en los componentes.
// ==========================================================================

export type IdFuncionalidad = "resultados" | "lector-pagos" | "bloqueados";

export interface Funcionalidad {
    nombre: string;
    /** Dónde aparece en la interfaz cuando está visible. */
    ubicacion: string;
    visible: boolean;
    /** Páginas propias: mientras esté oculta, no se enlazan desde otras pantallas. */
    rutas?: string[];
}

export const FUNCIONALIDADES: Record<IdFuncionalidad, Funcionalidad> = {
    // Ocultas para el lanzamiento comercial (07/11/2026).
    resultados: { nombre: "Resultados", ubicacion: "Eventos → sección «Resultados»", visible: false },
    "lector-pagos": { nombre: "Lector de pagos", ubicacion: "Menú lateral → Control", visible: false, rutas: ["/lector-pagos"] },
    bloqueados: { nombre: "Bloqueados", ubicacion: "Menú lateral → Control", visible: false, rutas: ["/bloqueados"] }
};

export function esVisible(id: IdFuncionalidad): boolean {
    return FUNCIONALIDADES[id]?.visible !== false;
}

/** ¿Se puede enlazar esta ruta? false si es la página de una funcionalidad oculta. */
export function rutaVisible(href: string): boolean {
    const ruta = href.split(/[?#]/)[0];
    return !Object.values(FUNCIONALIDADES).some((f) =>
        !f.visible && (f.rutas || []).some((r) => ruta === r || ruta.startsWith(`${r}/`)));
}

/** Quita de una lista las entradas cuya funcionalidad está oculta. */
export function soloVisibles<T extends { funcionalidad?: IdFuncionalidad }>(items: T[]): T[] {
    return items.filter((item) => !item.funcionalidad || esVisible(item.funcionalidad));
}
