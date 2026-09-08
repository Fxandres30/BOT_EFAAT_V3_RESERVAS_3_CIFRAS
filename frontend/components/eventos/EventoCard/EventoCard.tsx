import {
    Users,
    Database,
    Hash,
    Ticket,
    CircleDollarSign,
    Clock3,
    Lock,
    TimerReset,
    Trophy,
    Medal,
    Gift,
    ChevronDown,
} from "lucide-react";

import { StatusBadge, type StatusKind } from "@/components/ui/Badge";
import { formatHora12 } from "@/lib/formatHora";

import styles from "./EventoCard.module.css";

interface Props {
    evento: any;
}

function estadoInfo(estado?: string): { kind: StatusKind; label: string } {
    const e = (estado || "").toLowerCase();

    if (e === "abierto") return { kind: "active", label: "Abierto" };
    if (e === "cerrado") return { kind: "inactive", label: "Cerrado" };

    return { kind: "inactive", label: estado ? String(estado) : "Sin estado" };
}

function iconoPremio(tipo: string) {
    switch (tipo) {
        case "dos_ultimas_cifras":
            return <Trophy size={13} />;
        case "dos_primeras_cifras":
        case "dos_centro":
            return <Medal size={13} />;
        default:
            return <Gift size={13} />;
    }
}

export default function EventoCard({ evento }: Props) {

    const estado = estadoInfo(evento?.estado);

    const reservados = evento?.reservados ?? 0;
    const total = evento?.cantidad_numeros ?? 100;
    const porcentaje = total > 0 ? (reservados / total) * 100 : 0;

    const premios: any[] = Array.isArray(evento?.premios) ? evento.premios : [];

    return (
        <article className={styles.card}>

            <div className={styles.top}>
                <StatusBadge status={estado.kind} label={estado.label} size="sm" />
                <h3 className={styles.name}>{evento?.nombre_evento}</h3>
            </div>

            <div className={styles.meta}>
                {(evento?.grupo_nombre || evento?.grupo_id) && (
                    <span className={styles.metaItem}>
                        <Users size={12} />
                        {evento.grupo_nombre || evento.grupo_id}
                    </span>
                )}
                {evento?.tabla && (
                    <span className={styles.metaItem}>
                        <Database size={12} />
                        {evento.tabla}
                    </span>
                )}
                {evento?.cifras != null && (
                    <span className={styles.metaItem}>
                        <Hash size={12} />
                        {evento.cifras} cifras
                    </span>
                )}
                {evento?.cantidad_numeros != null && (
                    <span className={styles.metaItem}>
                        <Ticket size={12} />
                        {evento.cantidad_numeros} números
                    </span>
                )}
                {evento?.valor != null && (
                    <span className={styles.metaItem}>
                        <CircleDollarSign size={12} />
                        ${evento.valor}
                    </span>
                )}
            </div>

            <div className={styles.progress}>
                <div className={styles.progressTop}>
                    <span>
                        {reservados} / {total} números reservados
                    </span>
                    <span className={styles.progressPct}>{porcentaje.toFixed(0)}%</span>
                </div>
                <div className={styles.bar}>
                    <div
                        className={styles.barFill}
                        style={{ width: `${Math.min(porcentaje, 100)}%` }}
                    />
                </div>
            </div>

            <div className={styles.stats}>
                <div className={`${styles.stat} ${styles.statReservados}`}>
                    <span className={styles.statValue}>{evento?.reservados ?? 0}</span>
                    <span className={styles.statLabel}>Reserv.</span>
                </div>
                <div className={`${styles.stat} ${styles.statPagados}`}>
                    <span className={styles.statValue}>{evento?.pagados ?? 0}</span>
                    <span className={styles.statLabel}>Pagados</span>
                </div>
                <div className={`${styles.stat} ${styles.statPendientes}`}>
                    <span className={styles.statValue}>{evento?.pendientes ?? 0}</span>
                    <span className={styles.statLabel}>Pend.</span>
                </div>
                <div className={styles.stat}>
                    <span className={styles.statValue}>{evento?.libres ?? 0}</span>
                    <span className={styles.statLabel}>Libres</span>
                </div>
            </div>

            <div className={styles.times}>
                <span className={styles.timeItem}>
                    <Clock3 size={12} />
                    Sorteo <strong>{evento?.hora_fin ? formatHora12(evento.hora_fin) : "—"}</strong>
                </span>
                <span className={styles.timeItem}>
                    <Lock size={12} />
                    Cierra <strong>{evento?.hora_cierre ? formatHora12(evento.hora_cierre) : "—"}</strong>
                </span>
                <span className={styles.timeItem}>
                    <TimerReset size={12} />
                    Libera <strong>{evento?.hora_liberacion ? formatHora12(evento.hora_liberacion) : "—"}</strong>
                </span>
            </div>

            {premios.length > 0 && (
                <details className={styles.premios}>
                    <summary className={styles.premiosSummary}>
                        <Trophy size={13} />
                        Premios ({premios.length})
                        <ChevronDown size={14} className={styles.premiosChevron} />
                    </summary>
                    <div className={styles.premiosList}>
                        {premios.map((premio, index) => (
                            <div key={index} className={styles.premioItem}>
                                <span className={styles.premioName}>
                                    {iconoPremio(premio.tipo)}
                                    {premio.nombre}
                                </span>
                                <span className={styles.premioValue}>
                                    ${premio.premio.toLocaleString("es-CO")}
                                </span>
                            </div>
                        ))}
                    </div>
                </details>
            )}

        </article>
    );
}
