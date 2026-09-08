"use client";

import type { ReactNode } from "react";

import { cn } from "./cn";
import styles from "./Tabs.module.css";

export interface TabItem {
  value: string;
  label: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface TabsProps {
  items: TabItem[];
  value: string;
  onValueChange: (value: string) => void;
  fullWidth?: boolean;
  "aria-label"?: string;
  className?: string;
}

/**
 * Segmented control puramente visual/controlado. No maneja routing ni
 * contenido de paneles: el consumidor decide qué renderizar según `value`.
 */
export function Tabs({
  items,
  value,
  onValueChange,
  fullWidth = false,
  className,
  "aria-label": ariaLabel,
}: TabsProps) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(styles.tabs, fullWidth && styles.fullWidth, className)}
    >
      {items.map((item) => {
        const active = item.value === value;

        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={item.disabled}
            className={cn(styles.tab, active && styles.active)}
            onClick={() => onValueChange(item.value)}
          >
            {item.icon && (
              <span className={styles.icon} aria-hidden="true">
                {item.icon}
              </span>
            )}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
