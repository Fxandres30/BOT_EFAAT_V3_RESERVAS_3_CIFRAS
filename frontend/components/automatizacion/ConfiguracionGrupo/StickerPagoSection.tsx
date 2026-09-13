"use client";

import { useState } from "react";
import { Sticker, RefreshCw, Undo2, AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Badge, StatusBadge } from "@/components/ui/Badge";

import { useStickerPagoGrupo } from "@/hooks/useStickerPagoGrupo";

import styles from "./ConfiguracionGrupo.module.css";

interface Props {
    usuarioId: string | null;
    grupoId: string;
}

// FASE 2 + corrección arquitectónica — sticker de pago DE ESTE GRUPO.
//
// Muestra cuál de los DOS niveles está efectivamente en uso para este
// grupo (específico propio > predeterminado del tenant > ninguno — misma
// prioridad que resolverStickerPago() en el backend) y permite registrar/
// reemplazar/quitar SOLO el nivel específico de este grupo. El
// predeterminado se administra desde la sección general de
// /automatizacion/grupos (StickerPagoPredeterminadoSection), nunca desde
// aquí — evita que dos pantallas escriban la misma fila.
//
// Este componente SOLO presenta y dispara acciones a través de
// useStickerPagoGrupo.ts / useStickerPago.ts / services/automatizacion/
// stickerPago.ts — nunca lee ni escribe Supabase directamente, y NUNCA
// maneja ni muestra un fileSha256.
export default function StickerPagoSection({ usuarioId, grupoId }: Props) {

    const { cargando, nivelActivo, especifico, predeterminado } = useStickerPagoGrupo(usuarioId, grupoId);

    const [modalConfirmarUsoPredeterminado, setModalConfirmarUsoPredeterminado] = useState(false);

    async function confirmarUsarPredeterminado() {

        await especifico.desactivar();
        setModalConfirmarUsoPredeterminado(false);

    }

    return (

        <section className={styles.section}>

            <h2 className={styles.sectionTitle}>
                <Sticker size={15} /> Sticker de pago de este grupo
            </h2>

            {especifico.error && (
                <p className={styles.noteError}>
                    <AlertTriangle size={13} /> {especifico.error}
                </p>
            )}

            {cargando && (
                <p className={styles.nota}>Cargando configuración…</p>
            )}

            {!cargando && especifico.estado === "esperando" && (

                <>
                    <div className={styles.stickerStatusRow}>
                        <StatusBadge status="pending" label="Esperando sticker..." />
                    </div>

                    <p className={styles.nota}>
                        Envía ahora al grupo de WhatsApp el sticker que quieres utilizar como
                        sticker específico de este grupo.
                    </p>

                    <p className={styles.nota}>
                        El registro estará disponible durante {especifico.minutosExpiracion} minutos.
                    </p>

                    <div className={styles.stickerButtons}>
                        <Button
                            size="sm"
                            variant="secondary"
                            loading={especifico.procesando}
                            onClick={especifico.cancelarRegistro}
                        >
                            Cancelar
                        </Button>
                    </div>
                </>

            )}

            {!cargando && especifico.estado !== "esperando" && nivelActivo === "especifico" && (

                <>
                    <div className={styles.stickerStatusRow}>
                        <StatusBadge status="active" label="Sticker específico" />
                    </div>

                    <p className={styles.nota}>Este grupo utiliza un sticker propio.</p>

                    {especifico.config?.registrado_en && (
                        <p className={styles.stickerMeta}>
                            Registrado: {new Date(especifico.config.registrado_en).toLocaleString("es-CO")}
                        </p>
                    )}

                    <div className={styles.stickerButtons}>
                        <Button
                            size="sm"
                            variant="secondary"
                            leftIcon={<RefreshCw size={14} />}
                            loading={especifico.procesando}
                            onClick={especifico.iniciarRegistro}
                        >
                            Reemplazar
                        </Button>
                        <Button
                            size="sm"
                            variant="ghost"
                            leftIcon={<Undo2 size={14} />}
                            onClick={() => setModalConfirmarUsoPredeterminado(true)}
                        >
                            Usar predeterminado
                        </Button>
                    </div>
                </>

            )}

            {!cargando && especifico.estado !== "esperando" && nivelActivo === "predeterminado" && (

                <>
                    <div className={styles.stickerStatusRow}>
                        <Badge tone="primary" dot>Sticker predeterminado</Badge>
                    </div>

                    <p className={styles.nota}>Este grupo utiliza el sticker general del tenant.</p>

                    <div className={styles.stickerButtons}>
                        <Button
                            size="sm"
                            leftIcon={<Sticker size={14} />}
                            loading={especifico.procesando}
                            onClick={especifico.iniciarRegistro}
                        >
                            Configurar sticker específico
                        </Button>
                    </div>
                </>

            )}

            {!cargando && especifico.estado !== "esperando" && nivelActivo === "ninguno" && (

                <>
                    <div className={styles.stickerStatusRow}>
                        <StatusBadge status="inactive" label="Sin sticker" />
                    </div>

                    <p className={styles.nota}>
                        No existe sticker general ni específico. Puedes configurar uno para este
                        grupo, o registrar un predeterminado desde el listado de grupos.
                    </p>

                    <div className={styles.stickerButtons}>
                        <Button
                            size="sm"
                            leftIcon={<Sticker size={14} />}
                            loading={especifico.procesando}
                            onClick={especifico.iniciarRegistro}
                        >
                            Configurar
                        </Button>
                    </div>
                </>

            )}

            {modalConfirmarUsoPredeterminado && (

                <div className={styles.aviso}>
                    <span>
                        ¿Quitar el sticker específico de este grupo y volver a usar el
                        predeterminado{predeterminado.config?.sticker_sha256 ? "" : " (todavía no configurado)"}?
                    </span>
                    <div className={styles.stickerButtons}>
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setModalConfirmarUsoPredeterminado(false)}
                            disabled={especifico.procesando}
                        >
                            Cancelar
                        </Button>
                        <Button
                            size="sm"
                            variant="secondary"
                            loading={especifico.procesando}
                            onClick={confirmarUsarPredeterminado}
                        >
                            Usar predeterminado
                        </Button>
                    </div>
                </div>

            )}

        </section>

    );

}
