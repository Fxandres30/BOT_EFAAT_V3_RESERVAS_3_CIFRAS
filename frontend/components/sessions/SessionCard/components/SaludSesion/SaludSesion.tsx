"use client";

import type { StatusKind } from "@/components/ui/Badge";
import type { EstadoSalud, SaludSesion as Salud } from "@/services/sessions/saludSesiones";

import styles from "./SaludSesion.module.css";

// Etiqueta y color del estado REAL (no solo "WhatsApp conectado").
export const ESTADO_SALUD: Record<EstadoSalud, { kind: StatusKind; label: string }> = {
  saludable: { kind: "online", label: "Saludable · escuchando" },
  conectada: { kind: "online", label: "Conectada a WhatsApp" },
  conectando: { kind: "pending", label: "Conectando" },
  degradada: { kind: "warning", label: "Degradada" },
  desconectada: { kind: "offline", label: "Desconectada" },
  conflicto_lease: { kind: "warning", label: "Conflicto de lease" },
};

function hace(iso: string | null): string {
  if (!iso) return "—";
  const seg = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seg < 60) return `hace ${seg} s`;
  if (seg < 3600) return `hace ${Math.round(seg / 60)} min`;
  if (seg < 86400) return `hace ${Math.round(seg / 3600)} h`;
  return new Date(iso).toLocaleString("es-CO");
}

interface Props {
  salud: Salud;
}

export default function SaludSesion({ salud }: Props) {
  const grave = salud.estado === "desconectada" && salud.causas.length > 0 && !!salud.accion;
  const alerta = salud.estado === "degradada" || salud.estado === "conflicto_lease";

  return (
    <div
      className={[styles.salud, alerta ? styles.alerta : "", grave ? styles.grave : ""].join(" ")}
      aria-live="polite"
    >
      {salud.causas.length > 0 && (
        <ul className={styles.causas}>
          {salud.causas.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      )}

      {salud.accion && <p className={styles.accion}>{salud.accion}</p>}

      <dl className={styles.tiempos}>
        <dt>Conectada</dt>
        <dd>{hace(salud.conectadoEn)}</dd>
        <dt>Escuchando desde</dt>
        <dd>{hace(salud.listenerEn)}</dd>
        <dt>Último mensaje</dt>
        <dd>{hace(salud.ultimoMensajeRecibidoEn)}</dd>
        <dt>Último procesado OK</dt>
        <dd>{hace(salud.ultimoProcesadoOkEn)}</dd>
        {salud.ultimoError && (
          <>
            <dt>Último error</dt>
            <dd title={salud.ultimoError.mensaje}>{hace(salud.ultimoError.en)}</dd>
          </>
        )}
        {salud.recuperaciones[0] && (
          <>
            <dt>Recuperación auto.</dt>
            <dd title={salud.recuperaciones[0].causa}>{hace(salud.recuperaciones[0].en)}</dd>
          </>
        )}
        {salud.lease && !salud.lease.propio && salud.lease.vigente && (
          <>
            <dt>Atendida por</dt>
            <dd>otra instancia ({salud.lease.ubicacion || "?"})</dd>
          </>
        )}
      </dl>
    </div>
  );
}
