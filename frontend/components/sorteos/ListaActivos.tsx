"use client";

import { Radio } from "lucide-react";

import { Badge, Button, Card, EmptyState } from "@/components/ui";
import type { SorteoActivo } from "@/services/sorteos/apiSorteos";
import styles from "./Sorteos.module.css";

interface Props {
    activos: SorteoActivo[];
    onEditar: (eventoId: string) => void;
}

const fechaLegible = (f: string | null) => (f ? f.split("-").reverse().join("/") : "sin fecha");

// Sorteos EN CURSO del cliente (eventos_bot), los haya detectado el bot o
// publicado el panel: el mismo editor que «Editar» en Tablas.
export default function ListaActivos({ activos, onEditar }: Props) {

    if (!activos.length) {
        return <EmptyState icon={<Radio size={28} />} title="No hay sorteos en curso" description="Aquí aparecen los sorteos activos de tus grupos, los detecte EFAAT en el grupo o los publiques desde el panel." />;
    }

    return (
        <div className={styles.lista}>
            {activos.map(s => (
                <Card key={s.id} padding="md" className={styles.tarjeta}>
                    <div className={styles.tarjetaCabecera}>
                        <h3 className={styles.tarjetaTitulo}>{s.nombre || "Sorteo sin nombre"}</h3>
                        <Badge tone={s.origen === "panel" ? "primary" : "neutral"} dot>{s.origen === "panel" ? "Creado desde el panel" : "Detectado en el grupo"}</Badge>
                    </div>
                    <div className={styles.meta}>
                        <span>Sorteo: {fechaLegible(s.fecha_evento)} {s.hora_fin || ""}{s.hora_cierre ? ` · cierre ${s.hora_cierre}` : ""}</span>
                        <span>{s.valor ? `$${s.valor.toLocaleString("es-CO")} por número` : "Sin valor"} · {s.reservados} reservado(s) · {s.pagados} pagado(s)</span>
                        <span>{s.grupos.map(g => g.grupo_nombre || g.grupo_id).join(" · ")}</span>
                    </div>
                    <div className={styles.acciones}>
                        <Button size="sm" variant="secondary" onClick={() => onEditar(s.id)}>Editar</Button>
                    </div>
                </Card>
            ))}
        </div>
    );

}
