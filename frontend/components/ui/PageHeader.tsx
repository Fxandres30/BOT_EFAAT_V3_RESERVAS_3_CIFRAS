import type { ReactNode } from "react";

import { cn } from "./cn";
import styles from "./headers.module.css";

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  description,
  icon,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn(styles.pageHeader, className)}>
      <div className={styles.texts}>
        <div className={styles.titleRow}>
          {icon && (
            <span className={styles.icon} aria-hidden="true">
              {icon}
            </span>
          )}
          <h1 className={styles.pageTitle}>{title}</h1>
        </div>
        {description && <p className={styles.description}>{description}</p>}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  );
}
