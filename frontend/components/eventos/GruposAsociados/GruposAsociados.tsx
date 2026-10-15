import { Users } from "lucide-react";

import type { GrupoAsociado } from "../agruparEventos";

import styles from "./GruposAsociados.module.css";

// Grupos de WhatsApp donde se publicó un sorteo. Un solo grupo se muestra
// como siempre (su nombre); varios, como lista desplegable con el estado de
// cada uno.
export default function GruposAsociados({ grupos }: { grupos?: GrupoAsociado[] }) {

    const lista = (grupos || []).filter((g) => g.grupo_nombre || g.grupo_id);

    if (lista.length === 0) return null;

    const nombre = (g: GrupoAsociado) => g.grupo_nombre || "Grupo sin nombre";

    if (lista.length === 1) {
        return (
            <span className={styles.uno}>
                <Users size={12} /> {nombre(lista[0])}
            </span>
        );
    }

    return (
        <details className={styles.varios}>
            <summary className={styles.resumen}>
                <Users size={12} /> {lista.length} grupos
            </summary>
            <ul className={styles.lista} aria-label="Grupos del sorteo">
                {lista.map((g) => (
                    <li key={g.evento_id || g.grupo_id} className={styles.item}>
                        <span className={styles.nombre}>{nombre(g)}</span>
                        <span className={styles.estado}>
                            {g.activo === false ? "Cerrado" : g.abierto === false ? "Pendiente de abrir" : "Abierto"}
                        </span>
                    </li>
                ))}
            </ul>
        </details>
    );

}
