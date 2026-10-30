"use client";

import { Check, Pencil, Copy, Trash2 } from "lucide-react";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { Badge } from "@/components/ui/Badge";
import { avisar } from "@/components/ui/Avisos";
import { mensajeDeError, useAccionesPorClave } from "@/hooks/useAccion";

import DisenoThumbnail from "./DisenoThumbnail";
import type { TablaDiseno, TablaDisenoConfig } from "./disenoTypes";
import { TABLA_DISENO_PRESETS } from "@/services/tablas/disenoDefaults";

import styles from "./BibliotecaDisenosModal.module.css";

interface Props {
    open: boolean;
    onClose: () => void;
    disenos: TablaDiseno[];
    disenoActualId: string | null;
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
    onAplicar,
    onEditar,
    onDuplicar,
    onEliminar
}: Props) {

    // Una clave por botón ("aplicar:preset:clasico", "duplicar:<id>"...):
    // solo gira el pulsado y un doble clic no repite la acción. Antes los
    // cinco predeterminados compartían la clave "preset" y giraban a la vez.
    const { activas, ejecutar } = useAccionesPorClave();
    // Aplicar cambia el diseño de ESTA tabla: uno a la vez.
    const aplicandoAlguno = [...activas].some(c => c.startsWith("aplicar:"));

    async function accion(clave: string, fn: () => Promise<void> | void, textoError: string, textoOk?: string) {
        try {
            const r = await ejecutar(clave, async () => { await fn(); });
            if (r && textoOk) avisar.ok(textoOk);
        } catch (e) {
            avisar.error(mensajeDeError(e, textoError));
        }
    }

    function aplicar(clave: string, id: string | null, config: TablaDisenoConfig) {
        if (aplicandoAlguno) return;
        return accion(`aplicar:${clave}`, () => onAplicar(id, config), "No se pudo aplicar el diseño.", "Diseño aplicado a esta tabla.");
    }

    function duplicar(diseno: TablaDiseno) {
        return accion(`duplicar:${diseno.id}`, () => onDuplicar(diseno), "No se pudo duplicar el diseño.", `Diseño «${diseno.nombre}» duplicado.`);
    }

    function eliminar(diseno: TablaDiseno) {
        if (!confirm(`¿Eliminar el diseño "${diseno.nombre}"? Las tablas que lo usan conservan su configuración actual.`)) return;
        return accion(`eliminar:${diseno.id}`, () => onEliminar(diseno), "No se pudo eliminar el diseño.", `Diseño «${diseno.nombre}» eliminado.`);
    }

    const ocupado = (id: string) => activas.has(`duplicar:${id}`) || activas.has(`eliminar:${id}`) || activas.has(`aplicar:${id}`);

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
                                        loading={activas.has(`aplicar:preset:${preset.key}`)}
                                        disabled={aplicandoAlguno}
                                        onClick={() => aplicar(`preset:${preset.key}`, null, preset.config)}
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
                                                loading={activas.has(`aplicar:${diseno.id}`)}
                                                disabled={aplicandoAlguno || ocupado(diseno.id)}
                                                onClick={() => aplicar(diseno.id, diseno.id, diseno.config)}
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
                                                loading={activas.has(`duplicar:${diseno.id}`)}
                                                disabled={ocupado(diseno.id)}
                                                onClick={() => duplicar(diseno)}
                                            >
                                                <Copy size={14} />
                                            </IconButton>
                                            <IconButton
                                                label="Eliminar diseño"
                                                variant="danger"
                                                size="sm"
                                                loading={activas.has(`eliminar:${diseno.id}`)}
                                                disabled={ocupado(diseno.id)}
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
