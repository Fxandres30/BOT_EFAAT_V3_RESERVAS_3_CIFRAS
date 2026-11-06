"use client";

// Captura de la tabla de un SORTEO en el navegador — la única forma de
// obtener la imagen de cualquier publicación de un sorteo (vista previa,
// «Publicar ahora», «Confirmar y programar», «Reintentar», «Publicar en los
// grupos nuevos»). Es la función del botón «Compartir» (capturarTabla) sobre
// una copia oculta de TablaImprimible con los números de la vista previa del
// sorteo (vistaPrevia: los mismos que comprueba el backend con la huella) y
// el ancho de la columna del panel en este dispositivo. El backend la guarda
// (sorteos/capturaProgramada.js) y la envía si la tabla sigue igual en esa
// misma acción; un programado genera la suya a su hora con este mismo
// capturarTabla en Chromium headless (F4-G).

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import TablaImprimible from "@/components/tablas/TablaImprimible";
import { capturarTabla } from "@/services/tablas/capturarTabla";
import { medirPerfilCaptura, type PerfilCaptura } from "@/services/tablas/perfilCaptura";
import type { CapturaSorteo, VistaPrevia } from "@/services/sorteos/apiSorteos";
import type { PruebaImagen } from "@/services/sorteos/sorteoInstantaneo";

export interface UsoCapturaSorteo {
    imagen: PruebaImagen;
    /** Perfil del dispositivo donde se capturó (null hasta tener la vista). */
    perfil: PerfilCaptura | null;
    /** Imagen + huella para enviar al backend; undefined si aún no hay imagen. */
    captura: CapturaSorteo | undefined;
    /** Copia oculta que se captura: hay que renderizarla en la página. */
    copiaOculta: ReactNode;
    reintentar: () => void;
}

export function useCapturaSorteo(vista: VistaPrevia | null): UsoCapturaSorteo {

    const ref = useRef<HTMLDivElement>(null);
    const [imagen, setImagen] = useState<PruebaImagen>({ tipo: "probando" });
    const [intento, setIntento] = useState(0);
    // El perfil se mide una vez por vista (la columna del panel actual).
    const perfil = useMemo<PerfilCaptura | null>(() => (vista ? medirPerfilCaptura() : null), [vista]);

    useEffect(() => {
        if (!vista || !perfil) return;
        let vigente = true;
        (async () => {
            try {
                await document.fonts?.ready;
                const png = await capturarTabla(ref.current);
                if (vigente) setImagen({ tipo: "ok", imagen: png });
            } catch (err) {
                if (vigente) setImagen({ tipo: "error", mensaje: err instanceof Error ? err.message : "No se pudo generar la imagen de la tabla." });
            }
        })();
        return () => { vigente = false; };
    }, [vista, perfil, intento]);

    const copiaOculta = vista ? (
        <div aria-hidden style={{ position: "fixed", left: -10000, top: 0, pointerEvents: "none" }}>
            <TablaImprimible
                numerosDisponibles={vista.numeros.numerosDisponibles}
                numerosOcupados={vista.numeros.numerosOcupados}
                numerosPagados={vista.numeros.numerosPagados}
                diseno={vista.diseno.config}
                contenedorRef={ref}
                anchoContenido={perfil?.contenido}
            />
        </div>
    ) : null;

    return {
        imagen,
        perfil,
        captura: imagen.tipo === "ok" && vista?.huella_tabla ? { imagen: imagen.imagen, huella: vista.huella_tabla } : undefined,
        copiaOculta,
        reintentar: () => { setImagen({ tipo: "probando" }); setIntento(n => n + 1); }
    };

}
