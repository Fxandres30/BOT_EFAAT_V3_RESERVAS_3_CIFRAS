"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

import { deleteSession } from "../actions/deleteSession";

import styles from "./DeleteSessionModal.module.css";

type Props = {
  open: boolean;
  sessionId: string;
  nombre: string;
  onClose: () => void;
  onDeleted?: () => void;
};

export default function DeleteSessionModal({
  open,
  sessionId,
  nombre,
  onClose,
  onDeleted,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function eliminar() {
    if (loading) return;

    setLoading(true);
    setError(null);

    // El bot desconecta WhatsApp, borra la fila y las credenciales. Nunca
    // lanza ni queda esperando (ver services/sessions/accionSesion.ts).
    const res = await deleteSession(sessionId);

    setLoading(false);

    if (!res.ok) {
      setError(res.mensaje);
      return;
    }

    // No dependemos solo de Supabase Realtime (el evento DELETE puede no
    // llegar, p.ej. si la tabla no tiene REPLICA IDENTITY FULL):
    // refrescamos la lista explícitamente para que la card desaparezca
    // de inmediato, aquí mismo.
    onDeleted?.();

    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="Eliminar sesión"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="danger" onClick={eliminar} loading={loading}>
            Eliminar
          </Button>
        </>
      }
    >
      <p className={styles.text}>
        Vas a eliminar la sesión <strong>{nombre}</strong>.
      </p>

      <div className={styles.warn}>
        <AlertTriangle size={16} />
        <span>
          Se desconectará el número, y se eliminarán la sesión y sus archivos
          de autenticación. No se puede deshacer.
        </span>
      </div>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
