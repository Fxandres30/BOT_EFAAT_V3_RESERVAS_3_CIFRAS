import type { Metadata } from "next";

import styles from "./_componentes/panel.module.css";

// Área privada de analítica. Layout propio: NO usa DashboardLayout (sin
// Sidebar ni Topbar del panel) y no está enlazada desde ningún sitio.
export const metadata: Metadata = {
    title: "Panel privado",
    robots: { index: false, follow: false, nocache: true }
};

export default function LayoutAnaliticaPrivada({ children }: { children: React.ReactNode }) {
    return <div className={styles.raiz}>{children}</div>;
}
