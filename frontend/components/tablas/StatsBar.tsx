import { Percent } from "lucide-react";

import { ESTADOS_META_VISUAL } from "./estadoVisual";
import styles from "./StatsBar.module.css";

interface Stats {
    total: number;
    disponibles: number;
    reservados: number;
    pagados: number;
    enProceso: number;
    bloqueados: number;
    ocupacion: number;
}

interface Props {
    stats: Stats;
}

export default function StatsBar({ stats }: Props) {

    // "Reservados" agrupa también en_proceso/bloqueado: de cara al
    // usuario son números que no están disponibles ni pagados todavía.
    const reservadosVisual = stats.reservados + stats.enProceso + stats.bloqueados;

    const tarjetas = [
        {
            label: "Disponibles",
            valor: stats.disponibles,
            meta: ESTADOS_META_VISUAL.libre,
            tono: styles.libre
        },
        {
            label: "Reservados",
            valor: reservadosVisual,
            meta: ESTADOS_META_VISUAL.reservado,
            tono: styles.reservado
        },
        {
            label: "Pagados",
            valor: stats.pagados,
            meta: ESTADOS_META_VISUAL.pagado,
            tono: styles.pagado
        }
    ];

    // La barra solo dibuja el porcentaje ya calculado (0–100).
    const ocupacion = Math.min(100, Math.max(0, stats.ocupacion));

    return (

        <div className={styles.barra}>

            {tarjetas.map((t) => {

                const Icon = t.meta.icon;

                return (

                    <div key={t.label} className={`${styles.cifra} ${t.tono}`}>

                        <div className={styles.cifraFila}>
                            <p className={styles.etiqueta}>{t.label}</p>
                            <span className={styles.icono} aria-hidden="true"><Icon size={14} /></span>
                        </div>

                        <p className={styles.valor}>
                            {t.valor}
                            <span className={styles.total}>/ {stats.total}</span>
                        </p>

                    </div>

                );

            })}

            <div className={`${styles.cifra} ${styles.ocupacion}`}>

                <div className={styles.cifraFila}>
                    <p className={styles.etiqueta}>Ocupación</p>
                    <span className={styles.icono} aria-hidden="true"><Percent size={14} /></span>
                </div>

                <p className={styles.valor}>{stats.ocupacion}%</p>

                <div
                    className={styles.progreso}
                    role="progressbar"
                    aria-label="Ocupación de la tabla"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={ocupacion}
                >
                    <span style={{ width: `${ocupacion}%` }} />
                </div>

            </div>

        </div>

    );

}
