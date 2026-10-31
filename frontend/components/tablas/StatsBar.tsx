import { Wallet } from "lucide-react";

import type { ResumenTabla } from "@/services/tablas/resumenTabla";
import styles from "./StatsBar.module.css";

interface Props {
    resumen: ResumenTabla;
    precio: number;
}

const pesos = (n: number) => `$${n.toLocaleString("es-CO")}`;
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

// Resumen de la tabla en un solo bloque: total, ocupación, barra
// segmentada (reservados · pagados · libres) con su leyenda y, debajo, el
// recaudo del sorteo. Las cifras llegan ya calculadas (resumenTabla.ts).
export default function StatsBar({ resumen, precio }: Props) {

    const { total, libres, reservados, pagados, ocupacion, recaudo, pagadosDelSorteo, pagadosDeOtroSorteo } = resumen;

    const segmentos = [
        { clave: "reservados", etiqueta: "Reservados", valor: reservados, tono: styles.reservado },
        { clave: "pagados", etiqueta: "Pagados", valor: pagados, tono: styles.pagado },
        { clave: "libres", etiqueta: "Libres", valor: libres, tono: styles.libre }
    ];

    return (

        <section className={styles.resumen} aria-label="Resumen de la tabla">

            <div className={styles.cabecera}>
                <div className={styles.cifra}>
                    <span className={styles.rotulo}>Total de números</span>
                    <span className={styles.valor}>{total}</span>
                </div>
                <div className={`${styles.cifra} ${styles.derecha}`}>
                    <span className={styles.rotulo}>Ocupación</span>
                    <span className={styles.valor}>{ocupacion}<span className={styles.unidad}>%</span></span>
                </div>
            </div>

            <div
                className={styles.barra}
                role="img"
                aria-label={`${reservados} reservados, ${pagados} pagados y ${libres} libres de ${total}`}
            >
                {total > 0 && segmentos.filter(s => s.valor > 0).map(s => (
                    <span key={s.clave} className={`${styles.segmento} ${s.tono}`} style={{ flexGrow: s.valor }} />
                ))}
            </div>

            <ul className={styles.leyenda}>
                {segmentos.map(s => (
                    <li key={s.clave} className={s.tono}>
                        <span className={styles.punto} aria-hidden="true" />
                        <span>{s.etiqueta}</span>
                        <span className={styles.leyendaValor}>{s.valor}</span>
                    </li>
                ))}
            </ul>

            <div className={`${styles.recaudo} ${recaudo === null ? styles.recaudoSinSorteo : ""}`}>
                <span className={styles.recaudoIcono} aria-hidden="true"><Wallet size={18} /></span>
                <div className={styles.recaudoTexto}>
                    <span className={styles.recaudoRotulo}>Recaudo del sorteo</span>
                    {recaudo === null ? (
                        <>
                            <span className={styles.recaudoSinDato}>Sin sorteo activo</span>
                            <span className={styles.recaudoDetalle}>No hay un sorteo activo de {pesos(precio)} en esta tabla.</span>
                        </>
                    ) : (
                        <>
                            <span className={styles.recaudoValor}>{pesos(recaudo)}</span>
                            <span className={styles.recaudoDetalle}>
                                {plural(pagadosDelSorteo, "número pagado", "números pagados")} × {pesos(precio)}
                                {pagadosDeOtroSorteo > 0 && ` · ${plural(pagadosDeOtroSorteo, "pagado", "pagados")} de otro sorteo no se suma${pagadosDeOtroSorteo === 1 ? "" : "n"}`}
                            </span>
                        </>
                    )}
                </div>
            </div>

        </section>

    );

}
