"use client";

import type { NumeroReserva } from "./types";
import { ESTADOS_META_VISUAL, estadoEfectivo, estadoVisualSimplificado } from "./estadoVisual";
import styles from "./NumeroCard.module.css";

interface Props {
    numero: NumeroReserva;
    enGrupo: boolean;
    atenuado: boolean;
    deOtroEvento: boolean;
    /** Modo «Seleccionar» de Tablas: undefined = la cuadrícula no está en
     *  ese modo (la celda se ve exactamente como siempre). */
    seleccionado?: boolean;
    onClick: () => void;
}

export default function NumeroCard({
    numero,
    enGrupo,
    atenuado,
    deOtroEvento,
    seleccionado,
    onClick
}: Props) {

    // El estado real (incluye en_proceso/bloqueado) se conserva en
    // data-estado porque otras herramientas dependen de que
    // sea exactamente "libre" cuando el número está realmente disponible.
    // El color/label que ve el usuario, en cambio, siempre viene del
    // estado visual simplificado (Disponible / Reservado / Pagado).
    const estadoReal = estadoEfectivo(numero);
    const estadoVisual = estadoVisualSimplificado(numero);
    const meta = ESTADOS_META_VISUAL[estadoVisual];

    // El color de la celda (fondo/borde/texto) lo decide el diseño de la
    // tabla (variables --efaat-tabla-* aplicadas por Grid.tsx, ver
    // disenoCssVars.ts) — nunca un color fijo por estado.
    const claseEstado =
        estadoVisual === "libre" ? styles.available :
        estadoVisual === "pagado" ? styles.pagado :
        styles.reserved;

    return (

        <button
            id={`numero-${numero.numero}`}
            data-numero={numero.numero}
            data-estado={estadoReal}
            data-seleccionado={seleccionado ? "" : undefined}
            aria-pressed={seleccionado === undefined ? undefined : seleccionado}
            aria-label={`Número ${numero.numero}: ${meta.label}${enGrupo ? ", pertenece a un grupo" : ""}${deOtroEvento ? ", de otro evento" : ""}${seleccionado ? ", seleccionado" : ""}`}
            title={`${numero.numero} · ${meta.label}${numero.comprador ? ` · ${numero.comprador}` : ""}`}
            onClick={onClick}
            className={`
                group relative w-full aspect-square min-w-0
                flex items-center justify-center
                transition-all duration-150
                active:scale-90
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-indigo-500
                ${styles.cell} ${claseEstado}
                ${estadoVisual === "libre" ? "shadow-sm" : "shadow-md hover:shadow-lg hover:-translate-y-0.5"}
                ${atenuado ? "opacity-30 saturate-50" : ""}
            `}
        >

            {/* La marca de selección son elementos HIJOS, no estilos del botón:
                el botón tiene transición, y al ocultar la selección para
                «Compartir» un anillo en el propio botón se capturaba a mitad
                de la animación. Un hijo se quita del DOM al instante. */}
            {seleccionado && (
                <>
                    <span aria-hidden="true" className="pointer-events-none absolute -inset-1 rounded-[inherit] ring-4 ring-indigo-500" />
                    <span aria-hidden="true" className="pointer-events-none absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-indigo-600 text-white text-[11px] font-bold leading-5 text-center shadow">
                        ✓
                    </span>
                </>
            )}

            {/* Sin indicadores visuales de grupo / otro evento en la celda:
                la cara del número solo muestra su estado (Disponible /
                Reservado / Pagado). Esa información sigue en aria-label y
                en el modal de detalle (paquete, evento). */}
            <span className={`leading-none tabular-nums ${styles.number}`}>
                {numero.numero}
            </span>

        </button>

    );

}
