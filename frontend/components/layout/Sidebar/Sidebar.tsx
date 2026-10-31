"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
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
  ChevronDown,
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

// Entradas de NAV agrupadas por sección, en el mismo orden.
const SECCIONES = NAV.reduce<{ seccion: SeccionNav; items: NavItem[] }[]>((grupos, item) => {
  const ultimo = grupos[grupos.length - 1];
  if (ultimo && ultimo.seccion === item.seccion) ultimo.items.push(item);
  else grupos.push({ seccion: item.seccion, items: [item] });
  return grupos;
}, []);

function esActiva(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

// Secciones contraídas: preferencia visual de este navegador. El Sidebar se
// monta de nuevo en cada página, así que se recuerda en localStorage (sin
// almacenamiento, solo en memoria). En el servidor todas están abiertas.
const CLAVE_CONTRAIDAS = "efaat:sidebar:contraidas";
let contraidasEnMemoria = "[]";
const oyentesContraidas = new Set<() => void>();

function suscribirContraidas(oyente: () => void) {
  oyentesContraidas.add(oyente);
  window.addEventListener("storage", oyente);
  return () => {
    oyentesContraidas.delete(oyente);
    window.removeEventListener("storage", oyente);
  };
}

function leerContraidasCrudo(): string {
  try {
    return window.localStorage.getItem(CLAVE_CONTRAIDAS) ?? contraidasEnMemoria;
  } catch {
    return contraidasEnMemoria;
  }
}

function guardarContraidas(lista: SeccionNav[]) {
  contraidasEnMemoria = JSON.stringify(lista);
  try {
    window.localStorage.setItem(CLAVE_CONTRAIDAS, contraidasEnMemoria);
  } catch {
    // Sin almacenamiento: el cambio vale mientras la página siga abierta.
  }
  oyentesContraidas.forEach((oyente) => oyente());
}

function interpretarContraidas(crudo: string): SeccionNav[] {
  try {
    const valor = JSON.parse(crudo);
    return Array.isArray(valor) ? valor.filter((s) => SECCIONES.some((g) => g.seccion === s)) : [];
  } catch {
    return [];
  }
}

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
  const contraidasCrudo = useSyncExternalStore(suscribirContraidas, leerContraidasCrudo, () => "[]");
  const contraidas = useMemo(() => interpretarContraidas(contraidasCrudo), [contraidasCrudo]);

  function alternarSeccion(seccion: SeccionNav) {
    guardarContraidas(
      contraidas.includes(seccion)
        ? contraidas.filter((s) => s !== seccion)
        : [...contraidas, seccion]
    );
  }
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
      </div>

      <nav className="sidebar__nav" aria-label="Navegación principal">
        {SECCIONES.map(({ seccion, items }) => {
          const abierta = !contraidas.includes(seccion);
          const contieneActiva = items.some((item) => esActiva(pathname, item.href));
          const idLista = `sidebar-seccion-${seccion}`;

          return (
            <div key={seccion} className="sidebar__group">
              <button
                type="button"
                className="sidebar__section"
                aria-expanded={abierta}
                aria-controls={idLista}
                onClick={() => alternarSeccion(seccion)}
              >
                <span className="sidebar__sectionText">{seccion}</span>
                {/* Contraída con la página actual dentro: se sigue indicando. */}
                {!abierta && contieneActiva && (
                  <span className="sidebar__sectionDot" role="img" aria-label="Contiene la página actual" />
                )}
                <ChevronDown size={14} className="sidebar__sectionChevron" aria-hidden="true" />
              </button>

              <div
                id={idLista}
                className={abierta ? "sidebar__collapse sidebar__collapse--open" : "sidebar__collapse"}
                inert={!abierta}
              >
                <div className="sidebar__collapseInner">
                  {items.map((item) => {
                    const active = esActiva(pathname, item.href);
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
                        <span className="sidebar__itemText">{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            </div>
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
