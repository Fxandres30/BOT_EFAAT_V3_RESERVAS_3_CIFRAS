"use client";

import { useState } from "react";
import { LayoutTemplate } from "lucide-react";

import { Button, Card, EmptyState } from "@/components/ui";
import { apiSorteos, describirError, type Plantilla } from "@/services/sorteos/apiSorteos";
import styles from "./Sorteos.module.css";

interface Props {
    plantillas: Plantilla[];
    onActualizado: () => void;
}

// Las plantillas se crean desde «Nuevo sorteo» → «Guardar también como
// plantilla» y se usan desde el selector del formulario. Desactivar una
// plantilla no altera los sorteos que ya se crearon con ella (son copias).
export default function PlantillasPanel({ plantillas, onActualizado }: Props) {

    const [error, setError] = useState<string | null>(null);
    const [ocupado, setOcupado] = useState<string | null>(null);

    async function desactivar(p: Plantilla) {
        if (!window.confirm(`¿Desactivar la plantilla «${p.nombre}»? Los sorteos ya creados no cambian.`)) return;
        setOcupado(p.id);
        const r = await apiSorteos.actualizarPlantilla(p.id, { activa: false });
        setOcupado(null);
        if (!r.ok) setError(describirError(r));
        onActualizado();
    }

    if (!plantillas.length) {
        return <EmptyState icon={<LayoutTemplate size={28} />} title="Sin plantillas" description="Al crear un sorteo, escribe un nombre en «Guardar también como plantilla» para reutilizar su configuración." />;
    }

    return (
        <div className={styles.lista}>
            {error && <p className={`${styles.alerta} ${styles.alertaError}`}>{error}</p>}
            {plantillas.map(p => (
                <Card key={p.id} padding="md" className={styles.tarjeta}>
                    <div className={styles.tarjetaCabecera}>
                        <h3 className={styles.tarjetaTitulo}>{p.nombre}</h3>
                        <Button size="sm" variant="ghost" loading={ocupado === p.id} onClick={() => desactivar(p)}>Desactivar</Button>
                    </div>
                    <div className={styles.meta}>
                        <span>{p.config.nombre}</span>
                        <span>{p.config.hora_fin}</span>
                        <span>${Number(p.config.valor || 0).toLocaleString("es-CO")} por número</span>
                        <span>{p.config.premios?.length || 0} premio(s)</span>
                        <span>{p.config.recordatorios?.length || 0} recordatorio(s)</span>
                    </div>
                </Card>
            ))}
        </div>
    );

}
