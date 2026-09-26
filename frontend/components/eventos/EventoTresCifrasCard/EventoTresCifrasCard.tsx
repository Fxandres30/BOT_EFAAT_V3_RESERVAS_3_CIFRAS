import Link from "next/link";
import { Clock3, Lock, Ticket, Trophy, Users, ChevronDown, Gift, CircleDollarSign } from "lucide-react";

import { StatusBadge } from "@/components/ui/Badge";
import { formatHora12 } from "@/lib/formatHora";
import { obtenerTablaConfig } from "@/lib/tablasConfig";

import type { Evento } from "../types";
import type { Modalidad } from "../modalidad";

import styles from "./EventoTresCifrasCard.module.css";

interface Props {
    evento: Evento;
    modalidad: Exclude<Modalidad, "dos">;
}

// Tarjeta de sorteos de 3 cifras (000–999), de pago o gratis. Muestra solo
// columnas que ya existen en eventos_bot; lo que no exista se ve como "—".
export default function EventoTresCifrasCard({ evento, modalidad }: Props) {

    const gratis = modalidad === "tres_gratis";
    const abierto = (evento.estado || "").toLowerCase() === "abierto";
    const premios = Array.isArray(evento.premios) ? (evento.premios as unknown as { nombre?: string; premio?: number }[]) : [];
    const precio = Number(String(evento.valor ?? "").replace(/[^\d]/g, ""));

    // Reutiliza el detalle existente (/tablas/[precio]) solo cuando exista una
    // tabla configurada DE 3 CIFRAS para ese precio (hoy ninguna: todos los
    // precios apuntan a tablas de 2 cifras, que no sirven para 000–999).
    const administrable = !gratis && obtenerTablaConfig(precio)?.cifras === 3;

    return (
        <article className={`${styles.card} ${gratis ? styles.gratis : styles.pago}`}>

            <div className={styles.top}>
                <StatusBadge status={abierto ? "active" : "inactive"} label={evento.estado ? evento.estado.charAt(0).toUpperCase() + evento.estado.slice(1) : "Sin estado"} size="sm" />
                <span className={gratis ? styles.chipGratis : styles.chipPago}>
                    {gratis ? <Gift size={12} /> : <CircleDollarSign size={12} />}
                    {gratis ? "GRATIS" : `PAGO${precio ? ` · $${precio.toLocaleString("es-CO")}` : ""}`}
                </span>
            </div>

            <h3 className={styles.name}>{evento.nombre_evento || "Sorteo sin nombre"}</h3>

            <div className={styles.rango}>
                <Ticket size={13} /> 000–999 · 1000 números
            </div>

            <div className={styles.cifras}>
                <div className={styles.cifra}>
                    <span className={styles.cifraValor}>{evento.reservados ?? "—"}</span>
                    <span className={styles.cifraLabel}>{gratis ? "Participantes" : "Reservas"}</span>
                </div>
                {!gratis && (
                    <div className={styles.cifra}>
                        <span className={styles.cifraValor}>{evento.libres ?? "—"}</span>
                        <span className={styles.cifraLabel}>Disponibles</span>
                    </div>
                )}
                <div className={styles.cifra}>
                    <span className={styles.cifraValor}>{premios.length}</span>
                    <span className={styles.cifraLabel}>{premios.length === 1 ? "Premio" : "Premios"}</span>
                </div>
            </div>

            <div className={styles.horas}>
                <span><Clock3 size={12} /> Sorteo <strong>{evento.hora_fin ? formatHora12(evento.hora_fin) : "—"}</strong></span>
                {!gratis && (
                    <span><Lock size={12} /> Cierra <strong>{evento.hora_cierre ? formatHora12(evento.hora_cierre) : "—"}</strong></span>
                )}
                {evento.grupo_nombre && (
                    <span><Users size={12} /> {evento.grupo_nombre}</span>
                )}
            </div>

            {premios.length > 0 && (
                <details className={styles.premios}>
                    <summary>
                        <Trophy size={13} /> Premios ({premios.length})
                        <ChevronDown size={14} className={styles.chevron} />
                    </summary>
                    <ul>
                        {premios.map((p, i) => (
                            <li key={i}>
                                <span>{p.nombre || "Premio"}</span>
                                {typeof p.premio === "number" && <strong>${p.premio.toLocaleString("es-CO")}</strong>}
                            </li>
                        ))}
                    </ul>
                </details>
            )}

            {administrable ? (
                <Link href={`/tablas/${precio}`} prefetch={false} className={styles.administrar}>Administrar</Link>
            ) : (
                <button type="button" className={styles.administrar} disabled title="Falta la tabla de reservas 000–999 para esta modalidad">
                    Administrar
                </button>
            )}

        </article>
    );

}
