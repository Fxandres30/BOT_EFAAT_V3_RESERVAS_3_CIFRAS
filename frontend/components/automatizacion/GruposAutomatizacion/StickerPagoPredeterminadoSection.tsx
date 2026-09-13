"use client";

import { Sticker, RefreshCw, PowerOff, AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";

import { useStickerPago } from "@/hooks/useStickerPago";

import { useState } from "react";

interface Props {
    usuarioId: string | null;
}

// Sección tenant-wide: sticker de pago PREDETERMINADO (Nivel 1 —
// grupo_id=null). Vive en /automatizacion/grupos (esta pantalla) porque es
// la "casa" natural de configuración de grupos, y porque el registro
// PREDETERMINADO no depende de un grupo concreto: el admin lo envía en
// cualquier grupo real de WhatsApp (ver
// backend/bot/funciones/pagos/registrarStickerPago.js).
//
// La configuración ESPECÍFICA de cada grupo se administra aparte, en
// StickerPagoSection.tsx (dentro de ConfiguracionGrupo.tsx) — nunca desde
// aquí, para que solo una pantalla escriba cada fila.
export default function StickerPagoPredeterminadoSection({ usuarioId }: Props) {

    const {
        estado,
        config,
        error,
        procesando,
        minutosExpiracion,
        iniciarRegistro,
        cancelarRegistro,
        desactivar
    } = useStickerPago(usuarioId, null);

    const [modalDesactivarAbierto, setModalDesactivarAbierto] = useState(false);

    async function confirmarDesactivar() {

        await desactivar();
        setModalDesactivarAbierto(false);

    }

    if (!usuarioId) return null;

    return (

        <div className="grupo-card" style={{ marginBottom: 20 }}>

            <div className="grupo-card-nombre" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Sticker size={16} /> Sticker de pago predeterminado
            </div>

            <p className="grupos-seccion-subtitulo" style={{ margin: "4px 0 10px" }}>
                Se usa automáticamente para confirmar pagos en cualquier grupo que no tenga
                su propio sticker específico.
            </p>

            {error && (
                <p className="grupos-error">
                    <AlertTriangle size={13} style={{ verticalAlign: "text-bottom", marginRight: 4 }} />
                    {error}
                </p>
            )}

            {estado === "cargando" && <p className="grupos-seccion-subtitulo">Cargando…</p>}

            {estado === "sin_configurar" && (

                <>
                    <div style={{ marginBottom: 10 }}>
                        <StatusBadge status="inactive" label="No configurado" />
                    </div>

                    <Button size="sm" leftIcon={<Sticker size={14} />} loading={procesando} onClick={iniciarRegistro}>
                        Registrar sticker
                    </Button>
                </>

            )}

            {estado === "esperando" && (

                <>
                    <div style={{ marginBottom: 10 }}>
                        <StatusBadge status="pending" label="Esperando sticker..." />
                    </div>

                    <p className="grupos-seccion-subtitulo" style={{ marginBottom: 10 }}>
                        Envía ahora, desde un administrador, el sticker que quieres usar como
                        predeterminado en cualquier grupo real conectado. El registro estará
                        disponible durante {minutosExpiracion} minutos.
                    </p>

                    <Button size="sm" variant="secondary" loading={procesando} onClick={cancelarRegistro}>
                        Cancelar
                    </Button>
                </>

            )}

            {estado === "configurado" && (

                <>
                    <div style={{ marginBottom: 6 }}>
                        <StatusBadge status="active" label="Configurado" />
                    </div>

                    {config?.registrado_en && (
                        <p className="grupos-seccion-subtitulo" style={{ marginBottom: 10 }}>
                            Registrado: {new Date(config.registrado_en).toLocaleString("es-CO")}
                        </p>
                    )}

                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <Button size="sm" variant="secondary" leftIcon={<RefreshCw size={14} />} loading={procesando} onClick={iniciarRegistro}>
                            Reemplazar sticker
                        </Button>
                        <Button size="sm" variant="danger" leftIcon={<PowerOff size={14} />} onClick={() => setModalDesactivarAbierto(true)}>
                            Desactivar
                        </Button>
                    </div>
                </>

            )}

            <Modal
                open={modalDesactivarAbierto}
                onClose={() => setModalDesactivarAbierto(false)}
                title="¿Desactivar sticker de pago predeterminado?"
                description="Los grupos sin sticker específico dejarán de poder confirmar pagos por sticker."
                size="sm"
                footer={
                    <>
                        <Button variant="ghost" size="sm" onClick={() => setModalDesactivarAbierto(false)} disabled={procesando}>
                            Cancelar
                        </Button>
                        <Button variant="danger" size="sm" loading={procesando} onClick={confirmarDesactivar}>
                            Desactivar
                        </Button>
                    </>
                }
            />

        </div>

    );

}
