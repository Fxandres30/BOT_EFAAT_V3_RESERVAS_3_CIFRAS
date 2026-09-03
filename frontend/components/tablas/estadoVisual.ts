import {
    CheckCircle2,
    Clock,
    DollarSign,
    Lock,
    CircleDot,
    type LucideIcon
} from "lucide-react";

import type { EstadoNumero, NumeroReserva } from "./types";

// Un número "en_proceso" cuya retención ya venció vuelve a estar
// disponible aunque nadie lo haya liberado manualmente todavía. Esta es
// la ÚNICA función que decide eso — nada más debe comparar
// bloqueado_hasta con la hora actual por su cuenta.
export function estadoEfectivo(numero: NumeroReserva): EstadoNumero {

    if (
        numero.estado === "en_proceso" &&
        numero.bloqueado_hasta &&
        new Date(numero.bloqueado_hasta).getTime() <= Date.now()
    ) {
        return "libre";
    }

    return numero.estado;

}

interface EstadoMeta {
    label: string;
    icon: LucideIcon;
    dot: string;
    badge: string;
    card: string;
}

// Un solo lugar con color + icono + texto por estado — así ningún
// componente decide el color por su cuenta ni depende solo del color.
export const ESTADOS_META: Record<EstadoNumero, EstadoMeta> = {
    libre: {
        label: "Disponible",
        icon: CheckCircle2,
        dot: "bg-emerald-500",
        badge: "bg-emerald-50 text-emerald-700 border-emerald-200",
        card: "bg-emerald-500 hover:bg-emerald-600 text-white"
    },
    reservado: {
        label: "Reservado",
        icon: Clock,
        dot: "bg-amber-500",
        badge: "bg-amber-50 text-amber-700 border-amber-200",
        card: "bg-amber-500 hover:bg-amber-600 text-white"
    },
    pagado: {
        label: "Pagado",
        icon: DollarSign,
        dot: "bg-red-600",
        badge: "bg-red-50 text-red-700 border-red-200",
        card: "bg-red-600 hover:bg-red-700 text-white"
    },
    en_proceso: {
        label: "En proceso",
        icon: CircleDot,
        dot: "bg-sky-500",
        badge: "bg-sky-50 text-sky-700 border-sky-200",
        card: "bg-sky-500 hover:bg-sky-600 text-white"
    },
    bloqueado: {
        label: "Bloqueado",
        icon: Lock,
        dot: "bg-slate-700",
        badge: "bg-slate-100 text-slate-700 border-slate-300",
        card: "bg-slate-700 hover:bg-slate-800 text-white"
    }
};

export const FILTROS_ESTADO = [
    { valor: "todos", label: "Todos" },
    { valor: "libre", label: "Disponibles" },
    { valor: "reservado", label: "Reservados" },
    { valor: "pagado", label: "Pagados" },
    { valor: "en_proceso", label: "En proceso" },
    { valor: "bloqueado", label: "Bloqueados" },
    { valor: "grupo", label: "En grupo" }
] as const;

export type FiltroEstado = (typeof FILTROS_ESTADO)[number]["valor"];
