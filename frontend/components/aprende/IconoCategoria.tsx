import {
    Bot,
    CalendarClock,
    CalendarDays,
    MessageSquareText,
    Puzzle,
    Rocket,
    ScanLine,
    ShieldBan,
    Smartphone,
    Target,
    Ticket,
    UserRound,
    Users,
    type LucideIcon
} from "lucide-react";

import type { IconoCategoria as Clave } from "@/lib/aprende/articulos";

// Mismos iconos que el menú lateral para cada sección.
const ICONOS: Record<Clave, LucideIcon> = {
    rocket: Rocket,
    smartphone: Smartphone,
    ticket: Ticket,
    message: MessageSquareText,
    puzzle: Puzzle,
    users: Users,
    target: Target,
    "calendar-clock": CalendarClock,
    "calendar-days": CalendarDays,
    bot: Bot,
    scan: ScanLine,
    shield: ShieldBan,
    user: UserRound
};

export default function IconoCategoria({ icono, size = 16 }: { icono: Clave; size?: number }) {
    const Icon = ICONOS[icono];
    return <Icon size={size} aria-hidden="true" />;
}
