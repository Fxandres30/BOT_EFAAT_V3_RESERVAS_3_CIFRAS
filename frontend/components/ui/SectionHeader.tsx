import type { ReactNode } from "react";

import { cn } from "./cn";
import styles from "./headers.module.css";

export interface SectionHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function SectionHeader({
  title,
  description,
  icon,
  actions,
  className,
}: SectionHeaderProps) {
  return (
    <div className={cn(styles.sectionHeader, className)}>
      <div className={styles.texts}>
        <div className={styles.titleRow}>
          {icon && (
            <span className={styles.icon} aria-hidden="true">
              {icon}
            </span>
          )}
          <h2 className={styles.sectionTitle}>{title}</h2>
        </div>
        {description && <p className={styles.description}>{description}</p>}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  );
}
