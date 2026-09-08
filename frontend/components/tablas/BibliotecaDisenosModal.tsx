"use client";

import { useState } from "react";
import { Check, Pencil, Copy, Trash2 } from "lucide-react";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { Badge } from "@/components/ui/Badge";

import DisenoThumbnail from "./DisenoThumbnail";
import type { TablaDiseno, TablaDisenoConfig } from "./disenoTypes";
import { TABLA_DISENO_PRESETS } from "@/services/tablas/disenoDefaults";

import styles from "./BibliotecaDisenosModal.module.css";

interface Props {
    open: boolean;
    onClose: () => void;
    disenos: TablaDiseno[];
    disenoActualId: string | null;
    aplicando?: boolean;
    onAplicar: (origenId: string | null, config: TablaDisenoConfig) => Promise<void> | void;
    onEditar: (diseno: TablaDiseno) => void;
    onDuplicar: (diseno: TablaDiseno) => Promise<void> | void;
    onEliminar: (diseno: TablaDiseno) => Promise<void> | void;
}

export default function BibliotecaDisenosModal({
    open,
    onClose,
    disenos,
    disenoActualId,
    aplicando = false,
    onAplicar,
    onEditar,
    onDuplicar,
    onEliminar
}: Props) {

    const [procesando, setProcesando] = useState<string | null>(null);

    async function aplicar(id: string | null, config: TablaDisenoConfig) {
        setProcesando(id || "preset");
        try {
            await onAplicar(id, config);
        } catch (e) {
            alert(e instanceof Error ? e.message : "No se pudo aplicar el diseño.");
        } finally {
            setProcesando(null);
        }
    }

    async function duplicar(diseno: TablaDiseno) {
        setProcesando(diseno.id);
        try {
            await onDuplicar(diseno);
        } catch (e) {
            alert(e instanceof Error ? e.message : "No se pudo duplicar el diseño.");
        } finally {
            setProcesando(null);
        }
    }

    async function eliminar(diseno: TablaDiseno) {
        if (!confirm(`¿Eliminar el diseño "${diseno.nombre}"? Las tablas que lo usan conservan su configuración actual.`)) return;
        setProcesando(diseno.id);
        try {
            await onEliminar(diseno);
        } catch (e) {
            alert(e instanceof Error ? e.message : "No se pudo eliminar el diseño.");
        } finally {
            setProcesando(null);
        }
    }

    return (

        <Modal
            open={open}
            onClose={onClose}
            size="lg"
            title="Biblioteca de diseños"
            description="Aplicar un diseño crea una copia independiente para esta tabla — no afecta a otras tablas ni al diseño original."
        >
            <div className={styles.body}>

                <div className={styles.section}>
                    <span className={styles.sectionTitle}>Predeterminados</span>
                    <div className={styles.grid}>
                        {TABLA_DISENO_PRESETS.map((preset) => (
                            <div key={preset.key} className={styles.card}>
                                <DisenoThumbnail config={preset.config} />
                                <div className={styles.cardTop}>
                                    <span className={styles.cardName}>{preset.nombre}</span>
                                    <Button
                                        size="sm"
                                        variant="secondary"
                                        leftIcon={<Check size={13} />}
                                        loading={procesando === "preset" && aplicando}
                                        onClick={() => aplicar(null, preset.config)}
                                    >
                                        Aplicar
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className={styles.section}>
                    <span className={styles.sectionTitle}>Mis diseños</span>

                    {disenos.length === 0 ? (
                        <div className={styles.empty}>
                            Todavía no has guardado ningún diseño propio. Personaliza una tabla y usa
                            «Guardar como diseño» para empezar tu biblioteca.
                        </div>
                    ) : (
                        <div className={styles.grid}>
                            {disenos.map((diseno) => {

                                const activo = diseno.id === disenoActualId;

                                return (
                                    <div key={diseno.id} className={`${styles.card} ${activo ? styles.cardActive : ""}`}>

                                        <DisenoThumbnail config={diseno.config} />

                                        <div className={styles.cardTop}>
                                            <span className={styles.cardName} title={diseno.nombre}>{diseno.nombre}</span>
                                            {activo && <Badge tone="primary" size="sm">En uso</Badge>}
                                        </div>

                                        <div className={styles.cardActions}>
                                            <Button
                                                size="sm"
                                                variant="secondary"
                                                leftIcon={<Check size={13} />}
                                                loading={procesando === diseno.id && aplicando}
                                                onClick={() => aplicar(diseno.id, diseno.config)}
                                            >
                                                Aplicar
                                            </Button>
                                            <IconButton label="Editar diseño" variant="solid" size="sm" onClick={() => onEditar(diseno)}>
                                                <Pencil size={14} />
                                            </IconButton>
                                            <IconButton
                                                label="Duplicar diseño"
                                                variant="solid"
                                                size="sm"
                                                disabled={procesando === diseno.id}
                                                onClick={() => duplicar(diseno)}
                                            >
                                                <Copy size={14} />
                                            </IconButton>
                                            <IconButton
                                                label="Eliminar diseño"
                                                variant="danger"
                                                size="sm"
                                                disabled={procesando === diseno.id}
                                                onClick={() => eliminar(diseno)}
                                            >
                                                <Trash2 size={14} />
                                            </IconButton>
                                        </div>

                                    </div>
                                );

                            })}
                        </div>
                    )}
                </div>

            </div>
        </Modal>

    );

}
