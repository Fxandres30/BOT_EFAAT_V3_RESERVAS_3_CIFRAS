"use client";

import { useEffect, useRef, useState } from "react";
import { Settings2 } from "lucide-react";

import { Badge, Card, EmptyState, Modal } from "@/components/ui";
import type { SorteoEnGrupos } from "@/services/sorteos/apiSorteos";
import { BotonesSorteo, ConfirmarAccionSorteo, ESTADO_SORTEO, TITULO_ACCION, fechaLegible, type AccionPendiente } from "./AccionesSorteo";
import styles from "./Sorteos.module.css";

interface Props {
    sorteos: SorteoEnGrupos[];
    error: string | null;
    /** La primera carga terminó (antes, «no encontrado» no significa nada). */
    cargado?: boolean;
    /** Evento (eventos_bot.id de cualquiera de sus grupos) a resaltar: el
     *  que se abrió con «Administrar sorteo» desde Eventos. */
    destacado?: string | null;
    onEditar: (eventoId: string) => void;
    onActualizado: () => void;
}

// Sorteos que ya están en los grupos (detectados o publicados), activos y
// recientes, con acciones por grupo o para todo el sorteo (AccionesSorteo).
export default function AdministrarSorteos({ sorteos, error, cargado = true, destacado = null, onEditar, onActualizado }: Props) {

    const [pendiente, setPendiente] = useState<AccionPendiente | null>(null);
    const [resultado, setResultado] = useState<string | null>(null);

    const esDestacado = (s: SorteoEnGrupos) => !!destacado && (s.id === destacado || s.grupos.some(g => g.evento_id === destacado));
    const hayDestacado = sorteos.some(esDestacado);
    const tarjetaDestacada = useRef<HTMLDivElement>(null);
    const desplazado = useRef(false);

    // Una sola vez por visita: llevar la vista al sorteo abierto desde Eventos.
    useEffect(() => {
        if (!hayDestacado || desplazado.current) return;
        desplazado.current = true;
        tarjetaDestacada.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, [hayDestacado]);

    if (error) return <p className={`${styles.alerta} ${styles.alertaError}`} role="alert">No se pudieron cargar los sorteos: {error}</p>;

    if (!sorteos.length) {
        return <EmptyState icon={<Settings2 size={28} />} title="No hay sorteos para administrar" description="Aquí aparecen los sorteos de tus grupos (en curso y de los últimos 30 días), los detecte EFAAT o los publiques desde el panel." />;
    }

    return (
        <div className={styles.lista}>

            {resultado && <p className={`${styles.alerta} ${styles.alertaInfo}`} role="status">{resultado}</p>}
            {destacado && cargado && !hayDestacado && (
                <p className={`${styles.alerta} ${styles.alertaAviso}`} role="status">
                    El sorteo que abriste desde Eventos no aparece aquí: se eliminó o terminó hace más de 30 días. Estos son tus sorteos en los grupos.
                </p>
            )}

            {sorteos.map(s => (
                <div key={s.identidad || s.id} ref={esDestacado(s) ? tarjetaDestacada : undefined} className={esDestacado(s) ? styles.destacado : undefined}>
                <Card padding="md" className={styles.tarjeta}>
                    <div className={styles.tarjetaCabecera}>
                        <h3 className={styles.tarjetaTitulo}>{s.nombre || "Sorteo sin nombre"}</h3>
                        <Badge tone={ESTADO_SORTEO[s.estado]?.tono || "neutral"} dot>{ESTADO_SORTEO[s.estado]?.texto || s.estado}</Badge>
                    </div>
                    <div className={styles.meta}>
                        <span>Sorteo: {fechaLegible(s.fecha_evento)} {s.hora_fin || ""}{s.hora_cierre ? ` · cierre ${s.hora_cierre.slice(0, 5)}` : ""}</span>
                        <span>{s.valor ? `$${s.valor.toLocaleString("es-CO")} por número` : "Sin valor"} · {s.reservados} reservado(s) · {s.pagados} pagado(s)</span>
                    </div>
                    <BotonesSorteo sorteo={s} onEditar={onEditar} onAccion={p => { setResultado(null); setPendiente(p); }} />
                </Card>
                </div>
            ))}

            {pendiente && (
                <Modal open onClose={() => setPendiente(null)} title={TITULO_ACCION[pendiente.accion]}>
                    <ConfirmarAccionSorteo
                        key={`${pendiente.eventoId}-${pendiente.accion}-${pendiente.alcance}`}
                        pendiente={pendiente}
                        onVolver={() => setPendiente(null)}
                        onHecho={m => { setPendiente(null); setResultado(m); onActualizado(); }}
                    />
                </Modal>
            )}

        </div>
    );

}
