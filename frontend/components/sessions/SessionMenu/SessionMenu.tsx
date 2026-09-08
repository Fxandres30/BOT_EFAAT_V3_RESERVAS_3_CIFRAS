"use client";

import { useState } from "react";
import {
  MoreVertical,
  Pencil,
  Star,
  Link2,
  RefreshCw,
  Trash2,
} from "lucide-react";

import { IconButton } from "@/components/ui/IconButton";

import { shareSession } from "../actions/shareSession";

import styles from "./SessionMenu.module.css";

type Props = {
  sessionId: string;
  nombre: string;
  principal: boolean;
  conectado: boolean;
  esperandoQR: boolean;
  activa: boolean;
  onRename: () => void;
  onDelete: () => void;
  onPrincipal: () => void;
  onReconnect: () => void;
  onUseSession: () => void;
};

export default function SessionMenu({
  sessionId,
  principal,
  activa,
  onRename,
  onDelete,
  onPrincipal,
  onReconnect,
  onUseSession,
}: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className={styles.wrap}>
      <IconButton
        label="Opciones de la sesión"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(!open)}
      >
        <MoreVertical size={16} />
      </IconButton>

      {open && (
        <>
          <div
            className={styles.backdrop}
            onClick={() => setOpen(false)}
          />

          <div className={styles.menu} role="menu">
            <button
              type="button"
              className={styles.item}
              onClick={() => {
                setOpen(false);
                onRename();
              }}
            >
              <Pencil size={14} />
              Cambiar nombre
            </button>

            {!principal && (
              <button
                type="button"
                className={styles.item}
                onClick={() => {
                  setOpen(false);
                  onPrincipal();
                }}
              >
                <Star size={14} />
                Hacer preferida
              </button>
            )}

            {!activa && (
              <button
                type="button"
                className={styles.item}
                onClick={() => {
                  setOpen(false);
                  onUseSession();
                }}
              >
                <Star size={14} />
                Usar esta sesión
              </button>
            )}

            <button
              type="button"
              className={styles.item}
              onClick={async () => {
                setOpen(false);
                await shareSession(sessionId);
              }}
            >
              <Link2 size={14} />
              Compartir enlace
            </button>

            <button
              type="button"
              className={styles.item}
              onClick={() => {
                setOpen(false);
                onReconnect();
              }}
            >
              <RefreshCw size={14} />
              Reconectar
            </button>

            <button
              type="button"
              className={`${styles.item} ${styles.danger}`}
              onClick={() => {
                setOpen(false);
                onDelete();
              }}
            >
              <Trash2 size={14} />
              Eliminar
            </button>
          </div>
        </>
      )}
    </div>
  );
}
