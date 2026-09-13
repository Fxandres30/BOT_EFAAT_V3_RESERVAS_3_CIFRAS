"use client";

import type { LucideIcon } from "lucide-react";

import styles from "../ConfiguracionGrupo.module.css";

interface Props {
    icon: LucideIcon;
    titulo: string;
    descripcion: string;
}

// Placeholder honesto para acciones de la estructura conceptual que
// TODAVÍA no tienen ninguna configuración/lógica real detrás (verificado:
// cero código en frontend o backend para esto) — mismo criterio que ya
// usa tiposMensaje.ts para sus tipos "Futuro" (soportado:false): se deja
// visible en la navegación para que la estructura quede completa, pero
// sin inventar un interruptor que no haría nada real.
export default function SeccionProximamente({ icon: Icon, titulo, descripcion }: Props) {

    return (

        <section className={styles.section}>

            <h2 className={styles.sectionTitle}><Icon size={15} /> {titulo}</h2>

            <p className={styles.nota}>
                {descripcion} Todavía no existe ninguna configuración ni lógica real para esto en
                el sistema — se deja este espacio reservado en la navegación en vez de inventar un
                interruptor que no haría nada.
            </p>

        </section>

    );

}
