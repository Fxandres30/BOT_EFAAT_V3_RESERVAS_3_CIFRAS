"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Smartphone,
  Ticket,
  MessageSquareText,
  MessageCircle,
  Target,
  Bot,
  ScanLine,
  LogOut,
  type LucideIcon,
} from "lucide-react";

import "./Sidebar.css";

import { getUser } from "@/services/auth/getUser";
import { logout } from "@/services/auth/logout";

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

// Mismas rutas y etiquetas que antes — solo cambia la presentación del
// icono (emoji -> Lucide). No se añaden ni se quitan destinos.
const NAV: NavItem[] = [
  { href: "/sesiones", label: "Sesiones", icon: Smartphone },
  { href: "/tablas", label: "Reservas", icon: Ticket },
  { href: "/mensajes", label: "Mensajes", icon: MessageSquareText },
  { href: "/chats", label: "Chats", icon: MessageCircle },
  { href: "/eventos", label: "Eventos", icon: Target },
  { href: "/automatizacion", label: "Automatización", icon: Bot },
  { href: "/lector-pagos", label: "Lector de pagos", icon: ScanLine },
];

export default function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname();

  const [email, setEmail] = useState<string | null>(null);
  const [cerrando, setCerrando] = useState(false);

  useEffect(() => {
    async function cargar() {
      const { data } = await getUser();
      setEmail(data.user?.email || null);
    }

    cargar();
  }, []);

  async function cerrarSesion() {
    setCerrando(true);

    await logout();

    // Recarga completa (no solo navegación de Next.js): garantiza que
    // no quede ningún estado ni acceso visual al panel en memoria.
    window.location.href = "/login";
  }

  return (
    <aside className={open ? "sidebar sidebar--open" : "sidebar"}>
      <div className="sidebar__brand">
        <span className="sidebar__logo">E</span>
        <span className="sidebar__brandText">EFAAT</span>
      </div>

      <nav className="sidebar__nav">
        {NAV.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);

          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch={false}
              onClick={onClose}
              aria-current={active ? "page" : undefined}
              className={
                active
                  ? "sidebar__item sidebar__item--active"
                  : "sidebar__item"
              }
            >
              <Icon
                size={17}
                className="sidebar__itemIcon"
                aria-hidden="true"
              />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="sidebar__footer">
        <div className="sidebar__user">
          <span className="sidebar__avatar">
            {(email?.[0] || "?").toUpperCase()}
          </span>
          <span className="sidebar__email">{email || "Sin sesión"}</span>
        </div>

        <button
          type="button"
          className="sidebar__logout"
          disabled={cerrando}
          onClick={cerrarSesion}
        >
          <LogOut size={15} aria-hidden="true" />
          {cerrando ? "Cerrando sesión..." : "Cerrar sesión"}
        </button>
      </div>
    </aside>
  );
}
