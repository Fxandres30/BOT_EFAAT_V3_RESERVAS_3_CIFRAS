"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Users, SlidersHorizontal, type LucideIcon } from "lucide-react";

import styles from "./AutomatizacionNav.module.css";

interface Tab {
    href: string;
    label: string;
    icon: LucideIcon;
    exacto: boolean;
}

// Tres secciones. El contenido de los mensajes ya no se administra aquí:
// vive solo en la biblioteca central /mensajes (la ruta antigua
// /automatizacion/mensajes redirige allí).
const TABS: Tab[] = [
    { href: "/automatizacion", label: "Resumen", icon: LayoutDashboard, exacto: true },
    { href: "/automatizacion/grupos", label: "Grupos", icon: Users, exacto: false },
    { href: "/automatizacion/programacion", label: "Centro de control", icon: SlidersHorizontal, exacto: false }
];

export default function AutomatizacionNav() {

    const pathname = usePathname();

    return (

        <nav className={styles.nav}>

            {TABS.map((tab) => {

                const activo = tab.exacto
                    ? pathname === tab.href
                    : pathname === tab.href || pathname.startsWith(`${tab.href}/`);

                const Icon = tab.icon;

                return (

                    <Link
                        key={tab.href}
                        href={tab.href}
                        prefetch={false}
                        className={activo ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                        aria-current={activo ? "page" : undefined}
                    >
                        <Icon size={14} aria-hidden="true" />
                        {tab.label}
                    </Link>

                );

            })}

        </nav>

    );

}
