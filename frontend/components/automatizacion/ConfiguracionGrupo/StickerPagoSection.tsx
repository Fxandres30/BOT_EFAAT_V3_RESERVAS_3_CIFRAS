"use client";

import { useState } from "react";
import { Sticker, RefreshCw, PowerOff, AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";

import { useStickerPago } from "@/hooks/useStickerPago";

import styles from "./ConfiguracionGrupo.module.css";

interface Props {
    usuarioId: string | null;
    grupoId: string;
}

// FASE 2 — UI del panel para el sticker de pago (ver AUDITORÍA + FASE 1:
// backend/bot/funciones/pagos/registrarStickerPago.js /
// confirmarPagoPorSticker.js, backend/supabase_migrations/011_...).
//
// Este componente SOLO presenta y dispara acciones a través de
// useStickerPago.ts / services/automatizacion/stickerPago.ts — nunca lee
// ni escribe Supabase directamente, y NUNCA maneja ni muestra un
// fileSha256: ese valor es exclusivamente técnico y solo lo escribe el
// backend al capturar el sticker real desde WhatsApp.
export default function StickerPagoSection({ usuarioId, grupoId }: Props) {

    const {
        estado,
        config,
        error,
        procesando,
        minutosExpiracion,
        iniciarRegistro,
        cancelarRegistro,
        desactivar
    } = useStickerPago(usuarioId, grupoId);

    const [modalDesactivarAbierto, setModalDesactivarAbierto] = useState(false);

    async function confirmarDesactivar() {

        await desactivar();
        setModalDesactivarAbierto(false);

    }

    return (

        <section className={styles.section}>

            <h2 className={styles.sectionTitle}>
                <Sticker size={15} /> Sticker de pago
            </h2>

            {error && (
                <p className={styles.noteError}>
                    <AlertTriangle size={13} /> {error}
                </p>
            )}

            {estado === "cargando" && (
                <p className={styles.nota}>Cargando configuración…</p>
            )}

            {estado === "sin_configurar" && (

                <>
                    <div className={styles.stickerStatusRow}>
                        <StatusBadge status="inactive" label="No configurado" />
                    </div>

                    <p className={styles.nota}>
                        Elige un sticker de WhatsApp que utilizarás para confirmar los pagos
                        de las reservas.
                    </p>

                    <div className={styles.stickerButtons}>
                        <Button
                            size="sm"
                            leftIcon={<Sticker size={14} />}
                            loading={procesando}
                            onClick={iniciarRegistro}
                        >
                            Registrar sticker
                        </Button>
                    </div>
                </>

            )}

            {estado === "esperando" && (

                <>
                    <div className={styles.stickerStatusRow}>
                        <StatusBadge status="pending" label="Esperando sticker..." />
                    </div>

                    <p className={styles.nota}>
                        Envía ahora al grupo de WhatsApp el sticker que quieres utilizar para
                        confirmar pagos.
                    </p>

                    <p className={styles.nota}>
                        El registro estará disponible durante {minutosExpiracion} minutos.
                    </p>

                    <div className={styles.stickerButtons}>
                        <Button
                            size="sm"
                            variant="secondary"
                            loading={procesando}
                            onClick={cancelarRegistro}
                        >
                            Cancelar
                        </Button>
                    </div>
                </>

            )}

            {estado === "configurado" && (

                <>
                    <div className={styles.stickerStatusRow}>
                        <StatusBadge status="active" label="Configurado" />
                    </div>

                    <p className={styles.nota}>El sticker de pago está activo.</p>

                    {config?.registrado_en && (
                        <p className={styles.stickerMeta}>
                            Registrado: {new Date(config.registrado_en).toLocaleString("es-CO")}
                        </p>
                    )}

                    <div className={styles.stickerButtons}>
                        <Button
                            size="sm"
                            variant="secondary"
                            leftIcon={<RefreshCw size={14} />}
                            loading={procesando}
                            onClick={iniciarRegistro}
                        >
                            Reemplazar sticker
                        </Button>
                        <Button
                            size="sm"
                            variant="danger"
                            leftIcon={<PowerOff size={14} />}
                            onClick={() => setModalDesactivarAbierto(true)}
                        >
                            Desactivar
                        </Button>
                    </div>
                </>

            )}

            <Modal
                open={modalDesactivarAbierto}
                onClose={() => setModalDesactivarAbierto(false)}
                title="¿Desactivar sticker de pago?"
                description="Mientras esté desactivado, el bot no podrá confirmar pagos mediante sticker."
                size="sm"
                footer={
                    <>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setModalDesactivarAbierto(false)}
                            disabled={procesando}
                        >
                            Cancelar
                        </Button>
                        <Button
                            variant="danger"
                            size="sm"
                            loading={procesando}
                            onClick={confirmarDesactivar}
                        >
                            Desactivar
                        </Button>
                    </>
                }
            />

        </section>

    );

}
