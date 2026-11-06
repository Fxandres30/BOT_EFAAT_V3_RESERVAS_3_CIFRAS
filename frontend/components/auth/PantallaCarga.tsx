import { Spinner } from "@/components/ui/Spinner";

import styles from "./PantallaCarga.module.css";

// Pantalla de carga compartida mientras se comprueba la sesión (entrada de la
// aplicación instalada, login, registro y guardia del panel). Sustituye la
// pantalla en blanco: el fondo es el mismo del manifest (#0b1220), así que la
// pantalla de bienvenida del sistema enlaza con esta sin destello.
export default function PantallaCarga({ texto = "Cargando…" }: { texto?: string }) {
  return (
    <div className={styles.raiz} role="status" aria-live="polite">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className={styles.logo} src="/icons/icon-192.png" alt="" width={72} height={72} />
      <Spinner size={22} className={styles.spinner} />
      <p className={styles.texto}>{texto}</p>
    </div>
  );
}
