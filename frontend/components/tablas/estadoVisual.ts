import {
    Circle,
    Clock,
    CheckCircle2,
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

export type EstadoVisual = "libre" | "reservado" | "pagado";

// La interfaz solo distingue 3 estados (Disponible / Reservado / Pagado).
// "en_proceso" y "bloqueado" siguen existiendo como estados reales del
// dato (no se tocan ni se pierden), pero de cara al usuario se muestran
// como "Reservado": son números que no están disponibles y todavía no
// están pagados. Este es el ÚNICO lugar que decide ese mapeo — así
// ningún componente inventa su propia regla de qué color mostrar.
export function bucketEstado(estado: EstadoNumero): EstadoVisual {

    if (estado === "libre") return "libre";
    if (estado === "pagado") return "pagado";
    return "reservado";

}

export function estadoVisualSimplificado(numero: NumeroReserva): EstadoVisual {
    return bucketEstado(estadoEfectivo(numero));
}

interface EstadoMeta {
    label: string;
    icon: LucideIcon;
    dot: string;
    badge: string;
    card: string;
}

// Paleta de estado con función clara: Disponible = neutro, Reservado =
// rojo, Pagado = verde. Un solo lugar con color + icono + texto por
// estado — así ningún componente decide el color por su cuenta.
export const ESTADOS_META_VISUAL: Record<EstadoVisual, EstadoMeta> = {
    libre: {
        label: "Disponible",
        icon: Circle,
        dot: "bg-gray-300",
        badge: "bg-gray-100 text-gray-600 border-gray-200",
        card: "bg-white hover:bg-gray-50 text-gray-700 border border-gray-200"
    },
    reservado: {
        label: "Reservado",
        icon: Clock,
        dot: "bg-rose-500",
        badge: "bg-rose-50 text-rose-700 border-rose-200",
        card: "bg-rose-500 hover:bg-rose-600 text-white border border-rose-500"
    },
    pagado: {
        label: "Pagado",
        icon: CheckCircle2,
        dot: "bg-emerald-500",
        badge: "bg-emerald-50 text-emerald-700 border-emerald-200",
        card: "bg-emerald-500 hover:bg-emerald-600 text-white border border-emerald-500"
    }
};

// Metadatos por estado REAL (incluye en_proceso/bloqueado). Solo se usa
// para detalle administrativo puntual (p. ej. iconos internos), nunca
// para pintar la cuadrícula, los filtros, la leyenda o el resumen.
export const ESTADO_INTERNO_META: Record<EstadoNumero, { label: string; icon: LucideIcon }> = {
    libre: { label: "Disponible", icon: Circle },
    reservado: { label: "Reservado", icon: Clock },
    pagado: { label: "Pagado", icon: CheckCircle2 },
    en_proceso: { label: "En proceso", icon: CircleDot },
    bloqueado: { label: "Bloqueado", icon: Lock }
};

export const FILTROS_ESTADO = [
    { valor: "todos", label: "Todos" },
    { valor: "libre", label: "Disponibles" },
    { valor: "reservado", label: "Reservados" },
    { valor: "pagado", label: "Pagados" }
] as const;

export type FiltroEstado = (typeof FILTROS_ESTADO)[number]["valor"];

// Conteo de cada chip de FiltrosBar. Vive acá (y no en cada componente)
// para que "Reservados" siempre agrupe en_proceso/bloqueado de la misma
// forma en la barra de filtros, el resumen y la cuadrícula.
export function contarPorFiltro(numeros: NumeroReserva[]): Record<FiltroEstado, number> {

    const conteos: Record<FiltroEstado, number> = { todos: numeros.length, libre: 0, reservado: 0, pagado: 0 };

    numeros.forEach((n) => {
        conteos[estadoVisualSimplificado(n)]++;
    });

    return conteos;

}
