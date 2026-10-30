"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";

import { cn } from "./cn";
import styles from "./Avisos.module.css";

/**
 * Avisos del panel, en dos formas con el mismo aspecto:
 *   - `avisar.ok(...)` / `avisar.error(...)`: aviso flotante (toast) para el
 *     resultado de acciones generales. Se puede llamar desde cualquier parte;
 *     `<ContenedorAvisos />` (montado una vez en app/layout.tsx) los pinta.
 *   - `<Aviso tono="...">`: mensaje dentro de un formulario o modal, junto a
 *     lo que lo provocó.
 * Un aviso de éxito solo se emite tras la confirmación del servidor.
 */
export type TonoAviso = "ok" | "error" | "aviso" | "info";

interface AvisoFlotante {
  id: number;
  tono: TonoAviso;
  texto: string;
}

// Los errores se quedan más tiempo: hay que poder leerlos.
const DURACION: Record<TonoAviso, number> = { ok: 4000, info: 5000, aviso: 7000, error: 9000 };
const MAXIMO = 4;

let avisos: AvisoFlotante[] = [];
let siguienteId = 1;
const oyentes = new Set<() => void>();

function emitir() {
  oyentes.forEach((oyente) => oyente());
}

function cerrarAviso(id: number) {
  avisos = avisos.filter((a) => a.id !== id);
  emitir();
}

function mostrar(tono: TonoAviso, texto: string): number {
  const id = siguienteId++;
  // El mismo texto repetido (dos clics, dos fallos) no apila copias.
  avisos = [...avisos.filter((a) => !(a.tono === tono && a.texto === texto)), { id, tono, texto }].slice(-MAXIMO);
  emitir();
  return id;
}

export const avisar = {
  ok: (texto: string) => mostrar("ok", texto),
  error: (texto: string) => mostrar("error", texto),
  aviso: (texto: string) => mostrar("aviso", texto),
  info: (texto: string) => mostrar("info", texto),
  cerrar: cerrarAviso,
};

function suscribir(oyente: () => void) {
  oyentes.add(oyente);
  return () => {
    oyentes.delete(oyente);
  };
}

const SIN_AVISOS: AvisoFlotante[] = [];

const ICONO: Record<TonoAviso, typeof Info> = {
  ok: CheckCircle2,
  error: XCircle,
  aviso: AlertTriangle,
  info: Info,
};

export function ContenedorAvisos() {
  const lista = useSyncExternalStore(suscribir, () => avisos, () => SIN_AVISOS);

  return (
    <div className={styles.contenedor} aria-live="polite">
      {lista.map((a) => (
        <AvisoFlotanteItem key={a.id} aviso={a} />
      ))}
    </div>
  );
}

function AvisoFlotanteItem({ aviso }: { aviso: AvisoFlotante }) {
  useEffect(() => {
    const t = setTimeout(() => cerrarAviso(aviso.id), DURACION[aviso.tono]);
    return () => clearTimeout(t);
  }, [aviso.id, aviso.tono]);

  const Icono = ICONO[aviso.tono];

  return (
    <div role={aviso.tono === "error" ? "alert" : "status"} className={cn(styles.flotante, styles[aviso.tono])}>
      <Icono size={16} className={styles.icono} aria-hidden="true" />
      <span className={styles.texto}>{aviso.texto}</span>
      <button type="button" className={styles.cerrar} aria-label="Cerrar aviso" onClick={() => cerrarAviso(aviso.id)}>
        <X size={14} />
      </button>
    </div>
  );
}

export interface AvisoProps {
  tono?: TonoAviso;
  children: ReactNode;
  className?: string;
  onCerrar?: () => void;
}

/** Mensaje dentro de un formulario o modal. */
export function Aviso({ tono = "info", children, className, onCerrar }: AvisoProps) {
  const Icono = ICONO[tono];

  return (
    <div role={tono === "error" ? "alert" : "status"} className={cn(styles.enLinea, styles[tono], className)}>
      <Icono size={16} className={styles.icono} aria-hidden="true" />
      <span className={styles.texto}>{children}</span>
      {onCerrar && (
        <button type="button" className={styles.cerrar} aria-label="Cerrar aviso" onClick={onCerrar}>
          <X size={14} />
        </button>
      )}
    </div>
  );
}
