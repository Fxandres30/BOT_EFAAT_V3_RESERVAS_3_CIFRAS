"use client";

import { Users } from "lucide-react";

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
    // data-estado porque "Aleatorio" y otras herramientas dependen de que
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

            {enGrupo && (
                <span
                    className="absolute -top-1 -right-1 h-3.5 w-3.5 sm:h-4 sm:w-4 rounded-full bg-purple-600 border-2 border-white flex items-center justify-center z-10"
                    title="Pertenece a un grupo de reserva"
                >
                    <Users size={8} className="text-white" />
                </span>
            )}

            {deOtroEvento && (
                <span
                    className="absolute -top-1 -left-1 h-2.5 w-2.5 sm:h-3 sm:w-3 rounded-full bg-orange-400 border-2 border-white z-10"
                    title="Pertenece a otro evento/precio"
                />
            )}

            <span className={`leading-none tabular-nums ${styles.number}`}>
                {numero.numero}
            </span>

        </button>

    );

}
