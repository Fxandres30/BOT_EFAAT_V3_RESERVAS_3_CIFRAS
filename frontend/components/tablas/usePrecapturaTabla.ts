"use client";

// ==========================================================================
// Prepara POR ADELANTADO la imagen de la tabla (opción B, 14/11/2026) cuando
// la pantalla está inactiva, para que «Compartir» y «Cambiar grupos» no tengan
// que esperar a generarla. La regla de frescura está en
// services/tablas/precapturaTabla.ts: la imagen solo se usa si su clave es la
// de la tabla que hay en pantalla al compartir; si no, se genera en ese
// momento con el mismo generador (nunca una imagen desactualizada).
//
// La generación es una tarea larga que el navegador no puede trocear. Para no
// cruzarse con el usuario, solo empieza:
//   - cuando los datos llevan ESTABLE_MS sin cambiar,
//   - y el usuario lleva ESPERA_SIN_USO_MS sin tocar la página (más en la
//     primera, cuando aún no se sabe cuánto tarda este dispositivo),
//   - o en cuanto la pestaña queda oculta (el usuario se fue a WhatsApp).
// En un dispositivo LENTO (la última imagen tardó más de UMBRAL_LENTO_MS)
// solo se prepara con la pestaña oculta: ahí no bloquea a nadie; con la
// pestaña visible se genera al compartir, como antes.
//
// LIMITACIÓN CONOCIDA (pendiente de una optimización posterior; ver
// docs/LATENCIA_BOTONES_TABLAS.md): preparar la imagen sigue siendo UNA tarea
// larga e indivisible del navegador (dibujar el SVG que crea html-to-image:
// ≈0,3-0,8 s en escritorio, ≈3-4 s en un móvil lento). Aquí solo se elige
// CUÁNDO ocurre; si el usuario toca la pantalla justo en ese momento, su
// clic espera a que termine. En un móvil lento, la primera preparación
// ocurre con la pestaña visible (aún no se sabe que es lento) y, sin imagen
// preparada, «Compartir» muestra el spinner al instante pero la pantalla
// queda congelada mientras se genera. No se reduce sin cambiar el generador
// o bajar pixelRatio, y ninguna de las dos cosas está autorizada.
// ==========================================================================

import { useCallback, useEffect, useMemo, useRef } from "react";

import { crearPrecaptura, type EntradaPrecaptura, type ImagenPrecaptura } from "@/services/tablas/precapturaTabla";

const ESTABLE_MS = 1500;
const ESPERA_SIN_USO_MS = 2000;
const ESPERA_PRIMERA_MS = 3000;
const REINTENTO_MS = 1500;
const UMBRAL_LENTO_MS = 1500;

type Inactividad = { pedir: (fn: () => void) => number; cancelar: (id: number) => void };
const inactividad: Inactividad = typeof window !== "undefined" && "requestIdleCallback" in window
    ? { pedir: (fn) => window.requestIdleCallback(() => fn(), { timeout: 5000 }), cancelar: (id) => window.cancelIdleCallback(id) }
    : { pedir: (fn) => window.setTimeout(fn, 0), cancelar: (id) => window.clearTimeout(id) };

export interface PrecapturaTabla<I extends ImagenPrecaptura> {
    /** Imagen de la tabla TAL COMO ESTÁ AHORA: la preparada si coincide; si no, se genera ya. */
    obtener: () => Promise<I>;
}

/**
 * @param generar     el generador único (useGeneradorImagenTabla().generar)
 * @param construir   entrada de la imagen con los datos de ESTE momento (null: aún no hay tabla)
 */
export function usePrecapturaTabla<E extends EntradaPrecaptura, I extends ImagenPrecaptura>(
    generar: (entrada: E) => Promise<I>,
    construir: () => E | null
): PrecapturaTabla<I> {

    const precaptura = useMemo(() => crearPrecaptura<E, I>(generar), [generar]);

    // La función vigente, sin volver a programar nada cuando solo cambia su identidad.
    const construirRef = useRef(construir);
    useEffect(() => { construirRef.current = construir; });

    // Última interacción del usuario (para no empezar mientras usa la página).
    const ultimoUso = useRef(0);
    useEffect(() => {
        const marcar = () => { ultimoUso.current = performance.now(); };
        const eventos = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
        eventos.forEach(e => window.addEventListener(e, marcar, { capture: true, passive: true }));
        return () => eventos.forEach(e => window.removeEventListener(e, marcar, { capture: true }));
    }, []);

    // Programación: una sola cadena de temporizadores viva a la vez.
    const temporizador = useRef<number | null>(null);
    const ocioso = useRef<number | null>(null);

    const cancelar = useCallback(() => {
        if (temporizador.current != null) { window.clearTimeout(temporizador.current); temporizador.current = null; }
        if (ocioso.current != null) { inactividad.cancelar(ocioso.current); ocioso.current = null; }
    }, []);

    // El reintento se programa a través de esta referencia (la función se
    // vuelve a llamar a sí misma más tarde).
    const reintentar = useRef<() => void>(() => {});

    const intentar = useCallback(() => {
        ocioso.current = null;
        const entrada = construirRef.current();
        if (!entrada || !precaptura.falta(entrada)) return;
        const oculta = document.visibilityState === "hidden";
        const duracion = precaptura.ultimaDuracion();
        const lento = duracion != null && duracion > UMBRAL_LENTO_MS;
        const espera = duracion == null ? ESPERA_PRIMERA_MS : ESPERA_SIN_USO_MS;
        const quieto = performance.now() - ultimoUso.current >= espera;
        if (oculta || (!lento && quieto)) {
            // Un fallo no se guarda (precapturaTabla): al compartir se vuelve a generar.
            precaptura.obtener(entrada).catch(() => {});
            return;
        }
        // Todavía no: se vuelve a mirar más tarde (salvo en un dispositivo
        // lento con la pestaña visible, que espera a que se oculte).
        if (lento) return;
        temporizador.current = window.setTimeout(() => {
            temporizador.current = null;
            ocioso.current = inactividad.pedir(() => reintentar.current());
        }, REINTENTO_MS);
    }, [precaptura]);
    useEffect(() => { reintentar.current = intentar; }, [intentar]);

    const programar = useCallback(() => {
        cancelar();
        temporizador.current = window.setTimeout(() => {
            temporizador.current = null;
            ocioso.current = inactividad.pedir(intentar);
        }, ESTABLE_MS);
    }, [cancelar, intentar]);

    // Cada cambio de los datos (identidad de `construir`) vuelve a programar.
    useEffect(() => {
        programar();
        return cancelar;
    }, [construir, programar, cancelar]);

    // Pestaña oculta: el mejor momento (no bloquea a nadie). Cambio de ancho:
    // la imagen depende de él.
    useEffect(() => {
        const alCambiarVisibilidad = () => { if (document.visibilityState === "hidden") { cancelar(); intentar(); } };
        document.addEventListener("visibilitychange", alCambiarVisibilidad);
        window.addEventListener("resize", programar);
        return () => {
            document.removeEventListener("visibilitychange", alCambiarVisibilidad);
            window.removeEventListener("resize", programar);
        };
    }, [cancelar, intentar, programar]);

    const obtener = useCallback(() => {
        const entrada = construirRef.current();
        if (!entrada) return Promise.reject(new Error("No se encontró la tabla en pantalla."));
        return precaptura.obtener(entrada);
    }, [precaptura]);

    return { obtener };

}
