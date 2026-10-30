"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Ejecución de acciones de botones con la misma regla en todo el panel:
//   - bloqueo SÍNCRONO (ref): un doble clic antes de que React pinte el
//     estado «procesando» no lanza una segunda solicitud;
//   - estado `procesando` para el botón (spinner, deshabilitado);
//   - el error se captura y se devuelve como texto: ninguna promesa queda
//     sin capturar ni deja la pantalla bloqueada.
// No muestra éxito por su cuenta: quien llama decide qué mostrar con el
// resultado que confirmó el servidor.

export type ResultadoAccion<R> =
    | { ok: true; valor: R }
    | { ok: false; motivo: "en_curso" }
    | { ok: false; motivo: "error"; mensaje: string };

export function mensajeDeError(e: unknown, porDefecto = "No se pudo completar la operación."): string {
    return e instanceof Error && e.message ? e.message : porDefecto;
}

export interface OpcionesAccion {
    /** Texto si el error no trae uno propio. */
    mensajeError?: string;
    /** Además de guardarlo en `error` (p. ej. un aviso flotante). */
    onError?: (mensaje: string) => void;
}

export function useAccion<A extends unknown[], R>(accion: (...args: A) => Promise<R>, opciones: OpcionesAccion = {}) {

    const enCurso = useRef(false);
    const montado = useRef(true);
    const accionRef = useRef(accion);
    const opcionesRef = useRef(opciones);
    const [procesando, setProcesando] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        accionRef.current = accion;
        opcionesRef.current = opciones;
    });

    useEffect(() => {
        montado.current = true;
        return () => { montado.current = false; };
    }, []);

    const ejecutar = useCallback(async (...args: A): Promise<ResultadoAccion<R>> => {

        if (enCurso.current) return { ok: false, motivo: "en_curso" };
        enCurso.current = true;
        setProcesando(true);
        setError(null);

        try {
            return { ok: true, valor: await accionRef.current(...args) };
        } catch (e) {
            const mensaje = mensajeDeError(e, opcionesRef.current.mensajeError);
            if (montado.current) setError(mensaje);
            opcionesRef.current.onError?.(mensaje);
            return { ok: false, motivo: "error", mensaje };
        } finally {
            enCurso.current = false;
            if (montado.current) setProcesando(false);
        }

    }, []);

    const limpiarError = useCallback(() => setError(null), []);

    return { ejecutar, procesando, error, limpiarError };

}

// Varias acciones independientes a la vez, una por clave (un número de la
// tabla, un diseño...): cada clave se bloquea sola, así procesar el 05 no
// bloquea el 07 ni hace girar su botón. `iniciar`/`terminar` permiten
// mantener una clave ocupada más allá de la promesa (p. ej. hasta que la
// tabla termine de recargarse tras la respuesta del servidor).
export function useAccionesPorClave() {

    const enCurso = useRef(new Set<string>());
    const montado = useRef(true);
    const [activas, setActivas] = useState<ReadonlySet<string>>(() => new Set());

    useEffect(() => {
        montado.current = true;
        return () => { montado.current = false; };
    }, []);

    const publicar = useCallback(() => {
        if (montado.current) setActivas(new Set(enCurso.current));
    }, []);

    const iniciar = useCallback((clave: string): boolean => {
        if (enCurso.current.has(clave)) return false;
        enCurso.current.add(clave);
        publicar();
        return true;
    }, [publicar]);

    const terminar = useCallback((clave: string) => {
        if (enCurso.current.delete(clave)) publicar();
    }, [publicar]);

    const ocupada = useCallback((clave: string) => enCurso.current.has(clave), []);

    /** Ejecuta `accion` con la clave bloqueada. null = esa clave ya estaba en curso. Los errores se propagan. */
    const ejecutar = useCallback(async <R,>(clave: string, accion: () => Promise<R>): Promise<{ valor: R } | null> => {
        if (!iniciar(clave)) return null;
        try {
            return { valor: await accion() };
        } finally {
            terminar(clave);
        }
    }, [iniciar, terminar]);

    return { activas, iniciar, terminar, ocupada, ejecutar };

}
