"use client";

import { useEffect, useState } from "react";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

import { renameSession } from "../actions/renameSession";

type Props = {
  open: boolean;
  sessionId: string;
  nombreActual: string;
  onClose: () => void;
};

export default function SessionRenameModal({
  open,
  sessionId,
  nombreActual,
  onClose,
}: Props) {
  const [nombre, setNombre] = useState(nombreActual);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setNombre(nombreActual);
  }, [nombreActual]);

  async function guardar() {
    if (!nombre.trim()) return;

    setLoading(true);

    try {
      await renameSession(sessionId, nombre.trim());

      onClose();
    } catch (err) {
      console.error(err);

      alert("No fue posible cambiar el nombre.");
    }

    setLoading(false);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="Cambiar nombre"
      description="Escribe el nuevo nombre de la sesión."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={guardar} loading={loading}>
            Guardar
          </Button>
        </>
      }
    >
      <Input
        label="Nombre de la sesión"
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
        placeholder="Nombre de la sesión"
        autoFocus
      />
    </Modal>
  );
}
