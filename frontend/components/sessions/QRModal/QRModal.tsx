"use client";

import { QrCode, Copy } from "lucide-react";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

import styles from "./QRModal.module.css";

type Props = {
  open: boolean;
  qr: string;
  sessionId: string;
  segundos: number;
  onClose: () => void;
};

export default function QRModal({
  open,
  qr,
  sessionId,
  segundos,
  onClose,
}: Props) {
  async function copiarEnlace() {
    const enlace = `${window.location.origin}/conectar/${sessionId}`;

    await navigator.clipboard.writeText(enlace);

    alert("✅ Enlace copiado correctamente.");
  }

  const minutos = String(Math.floor(segundos / 60)).padStart(2, "0");
  const segundosTexto = String(segundos % 60).padStart(2, "0");

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="Conectar WhatsApp"
      description="Escanéalo desde WhatsApp › Dispositivos vinculados › Vincular un dispositivo."
      footer={
        <>
          <Button
            variant="ghost"
            leftIcon={<Copy size={14} />}
            onClick={copiarEnlace}
          >
            Compartir enlace
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cerrar
          </Button>
        </>
      }
    >
      <div className={styles.qrWrap}>
        {qr ? (
          <img src={qr} alt="Código QR de conexión" className={styles.qr} />
        ) : (
          <div className={styles.qrPlaceholder}>
            <QrCode size={28} />
            <span>Generando código…</span>
          </div>
        )}
      </div>

      <div className={styles.status}>
        <span className={styles.dot} aria-hidden="true" />
        Esperando conexión ·{" "}
        <strong>
          {minutos}:{segundosTexto}
        </strong>
      </div>

      <p className={styles.hint}>
        El código se actualiza solo cada pocos segundos. Si expira, se renueva
        sin recargar la página.
      </p>
    </Modal>
  );
}
