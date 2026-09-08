import type { ReactNode } from "react";

import { cn } from "./cn";
import styles from "./StatCard.module.css";

export type StatCardTone = "default" | "primary" | "success" | "warning" | "error";

export interface StatCardProps {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: StatCardTone;
  className?: string;
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = "default",
  className,
}: StatCardProps) {
  return (
    <div
      className={cn(
        styles.statCard,
        tone !== "default" && styles[`tone-${tone}`],
        className
      )}
    >
      <div className={styles.top}>
        <span className={styles.label}>{label}</span>
        {icon && (
          <span className={styles.icon} aria-hidden="true">
            {icon}
          </span>
        )}
      </div>
      <span className={styles.value}>{value}</span>
      {hint && <span className={styles.hint}>{hint}</span>}
    </div>
  );
}
