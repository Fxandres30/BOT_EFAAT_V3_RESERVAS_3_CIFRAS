"use client";

import { useState } from "react";

import { Badge, Modal } from "@/components/ui";
import type { SorteoEnGrupos } from "@/services/sorteos/apiSorteos";
import { BotonesSorteo, ConfirmarAccionSorteo, ESTADO_SORTEO, TITULO_ACCION, fechaLegible, type AccionPendiente } from "@/components/sorteos/AccionesSorteo";
import { ETIQUETA_ORIGEN, type OrigenEvento } from "./centroEventos";
import styles from "@/components/sorteos/Sorteos.module.css";

interface Props {
    sorteo: SorteoEnGrupos;
    origen: OrigenEvento | null;
    onClose: () => void;
    onEditar: (eventoId: string) => void;
    /** Acción hecha: mensaje para el administrador. */
    onHecho: (mensaje: string) => void;
}

// Administración de UN sorteo desde Eventos: sus grupos con su estado y las
// acciones que ya existían (cerrar, reabrir, desactivar en un grupo o en
// todos, cancelar, eliminar, editar). Mismas piezas que la antigua pestaña
// Sorteos → «Administrar»; el backend valida cada acción.
export default function AdministrarEventoModal({ sorteo: s, origen, onClose, onEditar, onHecho }: Props) {

    const [pendiente, setPendiente] = useState<AccionPendiente | null>(null);

    return (
        <Modal open onClose={onClose} size="lg" title={pendiente ? TITULO_ACCION[pendiente.accion] : "Administrar sorteo"}>
            {pendiente ? (
                <ConfirmarAccionSorteo
                    key={`${pendiente.eventoId}-${pendiente.accion}-${pendiente.alcance}`}
                    pendiente={pendiente}
                    onVolver={() => setPendiente(null)}
                    onHecho={onHecho}
                />
            ) : (
                <div className={styles.stack}>
                    <div className={styles.tarjetaCabecera}>
                        <h3 className={styles.tarjetaTitulo}>{s.nombre || "Sorteo sin nombre"}</h3>
                        <div className={styles.insignias}>
                            <Badge tone={ESTADO_SORTEO[s.estado]?.tono || "neutral"} dot>{ESTADO_SORTEO[s.estado]?.texto || s.estado}</Badge>
                            {origen && <Badge tone={ETIQUETA_ORIGEN[origen].tono} title={ETIQUETA_ORIGEN[origen].detalle}>{ETIQUETA_ORIGEN[origen].texto}</Badge>}
                        </div>
                    </div>
                    <div className={styles.meta}>
                        <span>Sorteo: {fechaLegible(s.fecha_evento)} {s.hora_fin || ""}{s.hora_cierre ? ` · cierre ${s.hora_cierre.slice(0, 5)}` : ""}</span>
                        <span>{s.valor ? `$${s.valor.toLocaleString("es-CO")} por número` : "Sin valor"} · {s.reservados === null || s.pagados === null ? "reservas sin contar en este momento" : `${s.reservados} reservado(s) · ${s.pagados} pagado(s)`}</span>
                    </div>
                    <BotonesSorteo sorteo={s} onEditar={onEditar} onAccion={setPendiente} />
                </div>
            )}
        </Modal>
    );

}
