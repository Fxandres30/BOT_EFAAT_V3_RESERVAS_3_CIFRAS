import {
    Circle,
    Clock,
    CheckCircle2,
    Lock,
    CircleDot,
    type LucideIcon
} from "lucide-react";

import type { EstadoNumero, NumeroReserva } from "./types";

// Estado con el que la pantalla trata un número: el REAL de la base. Un
// "en_proceso" con la retención vencida sigue retenido (ni el bot ni el
// servidor pueden reservarlo hasta desbloquearlo), así que se muestra en
// proceso, nunca como disponible (regla de veracidad, 30/10/2026). Que la
// retención esté vencida lo explica el detalle del número
// (estadoDeFila del backend: "en_proceso_vencido") y se resuelve con
// «Desbloquear». Sigue siendo la ÚNICA función que decide el estado de
// pantalla: los componentes no comparan bloqueado_hasta por su cuenta.
export function estadoEfectivo(numero: NumeroReserva): EstadoNumero {

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
// para detalle administrativo puntual (p. ej. iconos internos) y para el
// filtro por estado real de «Historial de números»; nunca para pintar la
// cuadrícula, la leyenda o el resumen.
export const ESTADO_INTERNO_META: Record<EstadoNumero, { label: string; icon: LucideIcon }> = {
    libre: { label: "Disponible", icon: Circle },
    reservado: { label: "Reservado", icon: Clock },
    pagado: { label: "Pagado", icon: CheckCircle2 },
    en_proceso: { label: "En proceso", icon: CircleDot },
    bloqueado: { label: "Bloqueado", icon: Lock }
};
