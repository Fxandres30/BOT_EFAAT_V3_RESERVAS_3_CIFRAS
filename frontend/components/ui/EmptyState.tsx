import type { ReactNode } from "react";

import { cn } from "./cn";
import styles from "./EmptyState.module.css";

export interface EmptyStateProps {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  /** Sin fondo ni borde punteado. */
  bare?: boolean;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  bare = false,
  className,
}: EmptyStateProps) {
  return (
    <div className={cn(styles.empty, bare && styles.bare, className)}>
      {icon && (
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
      )}
      <p className={styles.title}>{title}</p>
      {description && <p className={styles.description}>{description}</p>}
      {action && <div className={styles.action}>{action}</div>}
    </div>
  );
}
