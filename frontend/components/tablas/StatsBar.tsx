import { Wallet } from "lucide-react";

import type { ResumenTabla } from "@/services/tablas/resumenTabla";
import styles from "./StatsBar.module.css";

interface Props {
    resumen: ResumenTabla;
    precio: number;
}

const pesos = (n: number) => `$${n.toLocaleString("es-CO")}`;
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

// Resumen de la tabla en un solo bloque: barra segmentada (reservados ·
// pagados · libres), debajo una columna centrada por estado con su cifra
// y, al final, el recaudo del sorteo en una franja compacta. Las cifras
// llegan ya calculadas (resumenTabla.ts).
export default function StatsBar({ resumen, precio }: Props) {

    const { total, libres, reservados, pagados, recaudo, pagadosDelSorteo, pagadosDeOtroSorteo } = resumen;

    const segmentos = [
        { clave: "reservados", etiqueta: "Reservados", valor: reservados, tono: styles.reservado },
        { clave: "pagados", etiqueta: "Pagados", valor: pagados, tono: styles.pagado },
        { clave: "libres", etiqueta: "Libres", valor: libres, tono: styles.libre }
    ];

    return (

        <section className={styles.resumen} aria-label="Resumen de la tabla">

            <div
                className={styles.barra}
                role="img"
                aria-label={`${reservados} reservados, ${pagados} pagados y ${libres} libres de ${total}`}
            >
                {total > 0 && segmentos.filter(s => s.valor > 0).map(s => (
                    <span key={s.clave} className={`${styles.segmento} ${s.tono}`} style={{ flexGrow: s.valor }} />
                ))}
            </div>

            <ul className={styles.estados}>
                {segmentos.map(s => (
                    <li key={s.clave} className={`${styles.estado} ${s.tono}`}>
                        <span className={styles.estadoNombre}>{s.etiqueta}</span>
                        <span className={styles.estadoValor}>{s.valor}</span>
                    </li>
                ))}
            </ul>

            <div className={`${styles.recaudo} ${recaudo === null ? styles.recaudoSinSorteo : ""}`}>
                <span className={styles.recaudoIcono} aria-hidden="true"><Wallet size={15} /></span>
                <div className={styles.recaudoTexto}>
                    <span className={styles.recaudoRotulo}>Recaudo del sorteo</span>
                    <span className={styles.recaudoDetalle}>
                        {recaudo === null
                            ? `Sin sorteo activo de ${pesos(precio)} en esta tabla.`
                            : <>
                                {plural(pagadosDelSorteo, "número pagado", "números pagados")} × {pesos(precio)}
                                {pagadosDeOtroSorteo > 0 && ` · ${plural(pagadosDeOtroSorteo, "pagado", "pagados")} de otro sorteo no se suma${pagadosDeOtroSorteo === 1 ? "" : "n"}`}
                            </>}
                    </span>
                </div>
                {/* Sin sorteo activo no se afirma ninguna cifra: «—» y el porqué en el detalle. */}
                <span className={recaudo === null ? styles.recaudoSinDato : styles.recaudoValor}>
                    {recaudo === null ? "—" : pesos(recaudo)}
                </span>
            </div>

        </section>

    );

}
