"use client";

import { usePathname } from "next/navigation";
import { ChevronRight, Menu } from "lucide-react";

import { IconButton } from "@/components/ui/IconButton";

import "./Topbar.css";

import { entradaActual } from "../Sidebar/Sidebar";

interface TopbarProps {
  onToggleSidebar: () => void;
}

// Páginas fuera del menú principal que también tienen nombre propio.
const OTRAS: Record<string, string> = {
  "/mi-cuenta": "Mi cuenta",
  "/aprende": "Aprende a usar EFAAT",
  "/chats": "Chats",
};

// El usuario y "Cerrar sesión" viven únicamente en el Sidebar para tener
// una sola salida clara y consistente — no se duplican aquí. La barra solo
// dice dónde se está (sección › página), con las mismas etiquetas del menú.
export default function Topbar({ onToggleSidebar }: TopbarProps) {
  const pathname = usePathname();
  const entrada = entradaActual(pathname);
  const otra = Object.entries(OTRAS).find(
    ([href]) => pathname === href || pathname.startsWith(`${href}/`)
  )?.[1];

  const seccion = entrada?.seccion ?? (otra ? "Cuenta" : null);
  const pagina = entrada?.label ?? otra ?? "Panel de administración";

  return (
    <header className="topbar">
      <div className="topbar__menuSlot">
        <IconButton
          label="Abrir menú"
          variant="ghost"
          onClick={onToggleSidebar}
        >
          <Menu size={18} />
        </IconButton>
      </div>

      <nav className="topbar__context" aria-label="Ubicación">
        <span className="topbar__brand">EFAAT</span>
        {seccion && (
          <>
            <ChevronRight size={14} className="topbar__chevron" aria-hidden="true" />
            <span className="topbar__section">{seccion}</span>
          </>
        )}
        <ChevronRight size={14} className="topbar__chevron" aria-hidden="true" />
        <span className="topbar__subtitle" aria-current="page">{pagina}</span>
      </nav>
    </header>
  );
}
