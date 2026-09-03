"use client";

import { Users } from "lucide-react";

import type { NumeroReserva } from "./types";
import { ESTADOS_META, estadoEfectivo } from "./estadoVisual";

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

    const estado = estadoEfectivo(numero);
    const meta = ESTADOS_META[estado];
    const Icon = meta.icon;

    return (

        <button
            id={`numero-${numero.numero}`}
            data-numero={numero.numero}
            data-estado={estado}
            aria-label={`Número ${numero.numero}: ${meta.label}${enGrupo ? ", pertenece a un grupo" : ""}${deOtroEvento ? ", de otro evento" : ""}`}
            title={`${numero.numero} · ${meta.label}${numero.comprador ? ` · ${numero.comprador}` : ""}`}
            onClick={onClick}
            className={`
                relative w-full aspect-square min-w-0
                rounded-lg sm:rounded-xl shadow-md hover:shadow-xl hover:scale-105
                transition-all duration-200
                flex flex-col items-center justify-center gap-0.5
                ${meta.card}
                ${atenuado ? "opacity-30 saturate-50" : ""}
            `}
        >

            {enGrupo && (
                <span
                    className="absolute -top-1 -right-1 h-3.5 w-3.5 sm:h-4 sm:w-4 rounded-full bg-purple-600 border-2 border-white flex items-center justify-center"
                    title="Pertenece a un grupo de reserva"
                >
                    <Users size={8} className="text-white" />
                </span>
            )}

            {deOtroEvento && (
                <span
                    className="absolute -top-1 -left-1 h-2.5 w-2.5 sm:h-3 sm:w-3 rounded-full bg-orange-400 border-2 border-white"
                    title="Pertenece a otro evento/precio"
                />
            )}

            <span className="font-bold leading-none text-[clamp(0.75rem,3.2vw,1.35rem)]">
                {numero.numero}
            </span>

            <span className="flex items-center gap-1 leading-none">
                <Icon size={10} className="shrink-0" />
                <span className="hidden sm:inline text-[10px] font-medium opacity-90 whitespace-nowrap">
                    {meta.label}
                </span>
            </span>

        </button>

    );

}
