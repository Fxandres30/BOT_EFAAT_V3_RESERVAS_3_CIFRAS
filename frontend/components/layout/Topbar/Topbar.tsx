"use client";

import { Menu } from "lucide-react";

import { IconButton } from "@/components/ui/IconButton";

import "./Topbar.css";

interface TopbarProps {
  onToggleSidebar: () => void;
}

// El usuario y "Cerrar sesión" viven únicamente en el Sidebar para tener
// una sola salida clara y consistente — no se duplican aquí.
export default function Topbar({ onToggleSidebar }: TopbarProps) {
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

      <div className="topbar__context">
        <span className="topbar__brand">EFAAT</span>
        <span className="topbar__sep" aria-hidden="true" />
        <span className="topbar__subtitle">Panel de administración</span>
      </div>
    </header>
  );
}
