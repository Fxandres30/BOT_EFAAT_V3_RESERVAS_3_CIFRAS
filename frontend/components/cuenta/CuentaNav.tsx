"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserRound, BadgeCheck, Users, Receipt, LifeBuoy, type LucideIcon } from "lucide-react";

import { PageHeader } from "@/components/ui/PageHeader";
// Mismo estilo de pestañas que Automatización.
import styles from "@/components/automatizacion/AutomatizacionNav/AutomatizacionNav.module.css";

interface Tab {
    href: string;
    label: string;
    icon: LucideIcon;
}

const TABS: Tab[] = [
    { href: "/mi-cuenta", label: "Mi perfil", icon: UserRound },
    { href: "/mi-cuenta/suscripcion", label: "Mi suscripción", icon: BadgeCheck },
    { href: "/mi-cuenta/grupos", label: "Mis grupos", icon: Users },
    { href: "/mi-cuenta/pagos", label: "Pagos y renovaciones", icon: Receipt },
    { href: "/mi-cuenta/ayuda", label: "Ayuda y soporte", icon: LifeBuoy }
];

export default function CuentaHeader() {

    const pathname = usePathname();

    return (

        <>

            <PageHeader
                title="Mi cuenta"
                description="Tus datos, tu plan, tus grupos y cómo contactarnos. Solo ves la información de tu propia cuenta."
            />

            <nav className={styles.nav} aria-label="Secciones de Mi cuenta">

                {TABS.map((tab) => {

                    const activo = pathname === tab.href;
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

        </>

    );

}
