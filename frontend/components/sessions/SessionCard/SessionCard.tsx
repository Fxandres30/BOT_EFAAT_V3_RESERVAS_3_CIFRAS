"use client";

import { useState } from "react";
import { Power, QrCode, Plug, Star, Check } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Badge, StatusBadge, type StatusKind } from "@/components/ui/Badge";

import SessionMenu from "../SessionMenu/SessionMenu";
import SessionModals from "./components/SessionModals/SessionModals";

import { useSession } from "./hooks/useSession";

import { setActiveSession } from "@/services/sessions/setActiveSession";
import { setPreferredSession } from "@/services/sessions/setPreferredSession";
import { connectSession, isSessionNotFound } from "@/services/sessions/connectSession";

import styles from "./SessionCard.module.css";

interface Props {
  id: string;
  nombre: string;
  telefono: string;
  estado: string;
  principal: boolean;
  activa: boolean;
  onRefresh?: () => void;
}

export default function SessionCard({
  id,
  nombre,
  telefono,
  estado,
  principal,
  activa,
  onRefresh,
}: Props) {
  const {
    loading,
    open,
    qr,
    segundos,
    estadoActual,
    accionPrincipal,
    textoBoton,
    cerrarQR,
  } = useSession(id, estado, onRefresh);

  const conectado = estadoActual === "conectado";
  const esperandoQR = estadoActual === "esperando_qr";

  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const status: { kind: StatusKind; label: string } = conectado
    ? { kind: "online", label: "Conectada" }
    : esperandoQR
    ? { kind: "pending", label: "QR pendiente" }
    : { kind: "offline", label: "Desconectada" };

  const tieneTelefono = telefono && telefono !== "Sin conectar";

  return (
    <>
      <div className={styles.card}>
        <div className={styles.head}>
          <StatusBadge status={status.kind} label={status.label} />

          <SessionMenu
            sessionId={id}
            nombre={nombre}
            principal={principal}
            conectado={conectado}
            esperandoQR={esperandoQR}
            activa={activa}
            onRename={() => setRenameOpen(true)}
            onDelete={() => setDeleteOpen(true)}
            onPrincipal={async () => {
              try {
                await setPreferredSession(id);
              } catch (error) {
                console.error(error);
              }
            }}
            onReconnect={async () => {
              try {
                const res = await connectSession(id);

                if (isSessionNotFound(res)) {
                  alert(
                    "Esta sesión ya no existe (fue eliminada). " +
                      "Actualiza la lista y crea o selecciona una sesión válida."
                  );

                  onRefresh?.();
                }
              } catch (error) {
                console.error(error);
              }
            }}
            onUseSession={async () => {
              const res = await setActiveSession(id);
              console.log(res);
            }}
          />
        </div>

        <div className={styles.body}>
          <h3 className={styles.name} title={nombre}>
            {nombre}
          </h3>
          <p className={styles.phone}>
            {tieneTelefono ? telefono : "Sin número vinculado"}
          </p>
        </div>

        <div className={styles.flags}>
          {activa && (
            <Badge tone="primary" dot>
              Bot activo
            </Badge>
          )}
          {principal && <Badge tone="warning">Preferida</Badge>}
          {!activa && !principal && <Badge tone="neutral">En espera</Badge>}
        </div>

        <div className={styles.idRow} title={id}>
          <span className={styles.idLabel}>ID</span>
          <span className={styles.idValue}>{id}</span>
        </div>

        <div className={styles.actions}>
          <Button
            variant={conectado ? "danger" : "primary"}
            size="sm"
            fullWidth
            loading={loading}
            leftIcon={
              conectado ? (
                <Power size={14} />
              ) : esperandoQR ? (
                <QrCode size={14} />
              ) : (
                <Plug size={14} />
              )
            }
            onClick={accionPrincipal}
          >
            {textoBoton()}
          </Button>

          {conectado && (
            <Button
              variant="secondary"
              size="sm"
              fullWidth
              disabled={loading || activa}
              leftIcon={
                activa ? <Check size={14} /> : <Star size={14} />
              }
              onClick={async () => {
                if (activa) return;

                try {
                  // No hace falta recargar la página: useSessions/useSession
                  // ya están suscritos en tiempo real a cambios de la tabla
                  // "sesiones" (Supabase Realtime) y reflejan "activa"/
                  // "principal" solos en cuanto el backend los actualiza.
                  await setActiveSession(id);
                } catch (error) {
                  console.error(error);
                }
              }}
            >
              {activa ? "Sesión en uso" : "Usar esta sesión"}
            </Button>
          )}
        </div>
      </div>

      <SessionModals
        qrOpen={open}
        qr={qr}
        sessionId={id}
        segundos={segundos}
        cerrarQR={cerrarQR}
        renameOpen={renameOpen}
        deleteOpen={deleteOpen}
        nombre={nombre}
        onCloseRename={() => setRenameOpen(false)}
        onCloseDelete={() => setDeleteOpen(false)}
        onDeleted={onRefresh}
      />
    </>
  );
}
