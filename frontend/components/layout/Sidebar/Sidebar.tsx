"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Smartphone,
  Ticket,
  MessageSquareText,
  Users,
  Target,
  Bot,
  ScanLine,
  Puzzle,
  ShieldBan,
  CalendarClock,
  Zap,
  CalendarDays,
  LogOut,
  UserCog,
  GraduationCap,
  type LucideIcon,
} from "lucide-react";

import "./Sidebar.css";

import { getUser } from "@/services/auth/getUser";
import { logout } from "@/services/auth/logout";

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

// Secciones del menú: solo agrupan visualmente las entradas consecutivas
// (el orden de NAV no cambia).
export type SeccionNav = "Operación" | "Comunicación" | "Sorteos" | "Control";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  seccion: SeccionNav;
}

// Mismas rutas y etiquetas que antes, salvo "Chats" -> "Contactos": pasa a
// ser el directorio central de usuarios (identidad + reservas + pagos +
// actividad), reemplazando a /chats como pantalla principal. /chats sigue
// existiendo (mensajes por grupo, solo lectura) — ya no está en la
// navegación principal, pero no se eliminó ninguna funcionalidad.
export const NAV: NavItem[] = [
  { href: "/sesiones", label: "Sesiones", icon: Smartphone, seccion: "Operación" },
  { href: "/tablas", label: "Reservas", icon: Ticket, seccion: "Operación" },
  { href: "/mensajes", label: "Mensajes", icon: MessageSquareText, seccion: "Comunicación" },
  { href: "/variables-globales", label: "Variables globales", icon: Puzzle, seccion: "Comunicación" },
  { href: "/contactos", label: "Contactos", icon: Users, seccion: "Comunicación" },
  // Sorteos: Eventos (centro de control de todo lo que está en los grupos),
  // Programados (se publican más tarde) y el acceso directo «Publicar ahora».
  { href: "/eventos", label: "Eventos", icon: Target, seccion: "Sorteos" },
  { href: "/sorteos", label: "Programados", icon: CalendarClock, seccion: "Sorteos" },
  { href: "/sorteo-instantaneo", label: "Publicar ahora", icon: Zap, seccion: "Sorteos" },
  { href: "/loterias", label: "Calendario de loterías", icon: CalendarDays, seccion: "Sorteos" },
  { href: "/automatizacion", label: "Automatización", icon: Bot, seccion: "Control" },
  { href: "/lector-pagos", label: "Lector de pagos", icon: ScanLine, seccion: "Control" },
  { href: "/bloqueados", label: "Bloqueados", icon: ShieldBan, seccion: "Control" },
];

// Entrada del menú de la ruta actual (la barra superior la muestra).
export function entradaActual(pathname: string): NavItem | null {
  return NAV.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`)) ?? null;
}

export default function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const cuentaActiva =
    pathname === "/mi-cuenta" || pathname.startsWith("/mi-cuenta/");
  const aprendeActiva =
    pathname === "/aprende" || pathname.startsWith("/aprende/");

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
        <span className="sidebar__logo" aria-hidden="true">E</span>
        <span className="sidebar__brandText">EFAAT</span>
        <span className="sidebar__brandTag">Panel</span>
      </div>

      <nav className="sidebar__nav" aria-label="Navegación principal">
        {NAV.map((item, i) => {
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);

          const Icon = item.icon;

          const abreSeccion = i === 0 || NAV[i - 1].seccion !== item.seccion;

          return (
            <Fragment key={item.href}>
              {abreSeccion && (
                <span className="sidebar__section">{item.seccion}</span>
              )}
              <Link
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
                <span className="sidebar__itemText">{item.label}</span>
              </Link>
            </Fragment>
          );
        })}
      </nav>

      <div className="sidebar__footer">
        <div className="sidebar__user">
          <span className="sidebar__avatar">
            {(email?.[0] || "?").toUpperCase()}
          </span>
          <span className="sidebar__userText">
            <span className="sidebar__userLabel">Sesión iniciada</span>
            <span className="sidebar__email">{email || "Sin sesión"}</span>
          </span>
        </div>

        <Link
          href="/mi-cuenta"
          prefetch={false}
          onClick={onClose}
          aria-current={cuentaActiva ? "page" : undefined}
          className={
            cuentaActiva
              ? "sidebar__account sidebar__account--active"
              : "sidebar__account"
          }
        >
          <UserCog size={15} aria-hidden="true" />
          Mi cuenta
        </Link>

        <Link
          href="/aprende"
          prefetch={false}
          onClick={onClose}
          aria-current={aprendeActiva ? "page" : undefined}
          className={
            aprendeActiva
              ? "sidebar__account sidebar__account--active"
              : "sidebar__account"
          }
        >
          <GraduationCap size={15} aria-hidden="true" />
          <span className="sidebar__accountText">Aprende a usar EFAAT</span>
        </Link>

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
