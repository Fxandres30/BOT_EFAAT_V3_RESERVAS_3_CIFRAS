"use client";

// ==========================================================================
// GENERADOR ÚNICO DE LA IMAGEN DE UNA TABLA (regla del 06/11/2026).
//
// Es el de «Compartir imagen»: capturarTabla (services/tablas/capturarTabla.ts,
// html-to-image) sobre la cuadrícula Grid en modo limpio (TablaImprimible), con
// el diseño indicado y el ancho de la columna del panel. TODO lo que necesite
// la imagen de una tabla la obtiene aquí: «Compartir» en Tablas, la vista
// previa de los sorteos (instantáneo y programado), «Publicar ahora»,
// «Confirmar y programar», «Reintentar» y los grupos nuevos. Las diferencias
// entre usos son solo datos de entrada (números, diseño, ancho), nunca otro
// renderizador. Sin navegador del administrador (p. ej. un programado a su
// hora), el servidor ejecuta ESTE MISMO capturarTabla sobre TablaImprimible
// en Chromium headless (/tablas/imprimir, F4-G); nunca otro generador.
//
// Entrada: los números como los pinta la imagen (libres / ocupados /
// pagados: mismo contrato que el backend) + diseño + ancho. Salida: el PNG
// (data URL) y la huella de esos números, con el MISMO algoritmo que el
// backend (huellaTabla.ts ↔ capturaProgramada.huellaNumeros), para que el
// servidor compruebe que la imagen corresponde a la tabla real.
//
// Siempre la tabla COMPLETA: sin filtros de «Historial de números», sin
// atenuado y sin marcas de selección (la cuadrícula interactiva de Tablas no
// se fotografía).
// ==========================================================================

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import TablaImprimible from "@/components/tablas/TablaImprimible";
import type { TablaDisenoConfig } from "@/components/tablas/disenoTypes";
import { capturarTabla } from "@/services/tablas/capturarTabla";
import { huellaNumeros, type NumerosTabla } from "@/services/tablas/huellaTabla";

export interface EntradaImagenTabla {
    numeros: NumerosTabla;
    diseno?: TablaDisenoConfig | null;
    /** Ancho de la columna del panel donde se ve la tabla (perfilCaptura). */
    anchoContenido?: number | null;
}

export interface ImagenTabla {
    /** PNG en data URL, como lo produce «Compartir». */
    imagen: string;
    /** Huella de los números pintados (misma regla que el backend). */
    huella: string;
}

interface Trabajo { id: number; entrada: EntradaImagenTabla }

export interface GeneradorImagenTabla {
    /** Copia oculta que se fotografía: hay que renderizarla en la página. */
    copiaOculta: ReactNode;
    /** Genera la imagen de esa entrada. Las llamadas se atienden en orden. */
    generar: (entrada: EntradaImagenTabla) => Promise<ImagenTabla>;
}

export function useGeneradorImagenTabla(): GeneradorImagenTabla {

    const ref = useRef<HTMLDivElement>(null);
    const [trabajo, setTrabajo] = useState<Trabajo | null>(null);
    const siguiente = useRef(0);
    const montadas = useRef(new Map<number, () => void>());
    const cola = useRef<Promise<unknown>>(Promise.resolve());

    // La copia de ESTE trabajo ya está en la página: se puede fotografiar.
    useEffect(() => {
        if (!trabajo) return;
        const listo = montadas.current.get(trabajo.id);
        if (listo) { montadas.current.delete(trabajo.id); listo(); }
    }, [trabajo]);

    const generar = useCallback((entrada: EntradaImagenTabla): Promise<ImagenTabla> => {

        const ejecutar = async (): Promise<ImagenTabla> => {
            const id = ++siguiente.current;
            const montada = new Promise<void>(res => montadas.current.set(id, res));
            setTrabajo({ id, entrada });
            try {
                await montada;
                await document.fonts?.ready;
                const imagen = await capturarTabla(ref.current);
                const huella = await huellaNumeros(entrada.numeros);
                return { imagen, huella };
            } finally {
                montadas.current.delete(id);
                setTrabajo(actual => (actual?.id === id ? null : actual));
            }
        };

        const resultado = cola.current.then(ejecutar, ejecutar);
        cola.current = resultado.catch(() => undefined);
        return resultado;

    }, []);

    const copiaOculta = trabajo ? (
        <div aria-hidden key={trabajo.id} style={{ position: "fixed", left: -10000, top: 0, pointerEvents: "none" }}>
            <TablaImprimible
                numerosDisponibles={trabajo.entrada.numeros.numerosDisponibles}
                numerosOcupados={trabajo.entrada.numeros.numerosOcupados}
                numerosPagados={trabajo.entrada.numeros.numerosPagados}
                diseno={trabajo.entrada.diseno ?? null}
                contenedorRef={ref}
                anchoContenido={trabajo.entrada.anchoContenido ?? null}
            />
        </div>
    ) : null;

    return { copiaOculta, generar };

}
