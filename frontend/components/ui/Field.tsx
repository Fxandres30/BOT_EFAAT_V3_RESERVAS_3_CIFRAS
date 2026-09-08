import type { ReactNode } from "react";

import { cn } from "./cn";
import styles from "./Field.module.css";

export interface FieldProps {
  /** id del control asociado (para el `htmlFor` del label). */
  htmlFor?: string;
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  optional?: boolean;
  className?: string;
  children: ReactNode;
}

export function Field({
  htmlFor,
  label,
  hint,
  error,
  optional = false,
  className,
  children,
}: FieldProps) {
  return (
    <div className={cn(styles.field, className)}>
      {label && (
        <label className={styles.label} htmlFor={htmlFor}>
          {label}
          {optional && <span className={styles.optional}>opcional</span>}
        </label>
      )}
      {children}
      {error ? (
        <span className={styles.error}>{error}</span>
      ) : (
        hint && <span className={styles.hint}>{hint}</span>
      )}
    </div>
  );
}
