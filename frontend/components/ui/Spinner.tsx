import { cn } from "./cn";
import styles from "./Spinner.module.css";

export interface SpinnerProps {
  /** Lado en px. Por defecto 15 (el del texto de un botón). */
  size?: number;
  className?: string;
}

/**
 * Indicador de carga común de los botones (Button, IconButton y los botones
 * de las tablas). Decorativo: quien lo usa marca `aria-busy` en el control.
 */
export function Spinner({ size = 15, className }: SpinnerProps) {
  return (
    <span
      className={cn(styles.spinner, className)}
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}
