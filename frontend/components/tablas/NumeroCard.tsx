"use client";

import type { NumeroReserva } from "./types";
import { ESTADOS_META_VISUAL, estadoEfectivo, estadoVisualSimplificado } from "./estadoVisual";
import styles from "./NumeroCard.module.css";

interface Props {
    numero: NumeroReserva;
    enGrupo: boolean;
    atenuado: boolean;
    deOtroEvento: boolean;
    onClick: () => void;
}

export default function NumeroCard({
    numero,
    enGrupo,
    atenuado,
    deOtroEvento,
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
            aria-label={`Número ${numero.numero}: ${meta.label}${enGrupo ? ", pertenece a un grupo" : ""}${deOtroEvento ? ", de otro evento" : ""}`}
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
