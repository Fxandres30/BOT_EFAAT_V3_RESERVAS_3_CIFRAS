"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import "./AutomatizacionNav.css";

const TABS = [
    { href: "/automatizacion", label: "Resumen", icono: "📊", exacto: true },
    { href: "/automatizacion/grupos", label: "Grupos", icono: "👥", exacto: false },
    { href: "/automatizacion/mensajes", label: "Mensajes", icono: "✉️", exacto: false },
    { href: "/automatizacion/programacion", label: "Programación", icono: "🕒", exacto: false }
];

export default function AutomatizacionNav() {

    const pathname = usePathname();

    return (

        <nav className="automatizacion-nav">

            {TABS.map((tab) => {

                const activo = tab.exacto
                    ? pathname === tab.href
                    : pathname === tab.href || pathname.startsWith(`${tab.href}/`);

                return (

                    <Link
                        key={tab.href}
                        href={tab.href}
                        prefetch={false}
                        className={`automatizacion-tab ${activo ? "activo" : ""}`}
                    >
                        <span>{tab.icono}</span>
                        <span>{tab.label}</span>
                    </Link>

                );

            })}

        </nav>

    );

}
