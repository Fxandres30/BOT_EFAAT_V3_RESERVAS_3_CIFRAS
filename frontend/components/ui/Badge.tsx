import type { HTMLAttributes } from "react";

import { cn } from "./cn";
import styles from "./Badge.module.css";

export type BadgeTone = "neutral" | "primary" | "success" | "warning" | "error";
export type BadgeSize = "sm" | "md";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  size?: BadgeSize;
  dot?: boolean;
}

export function Badge({
  tone = "neutral",
  size = "md",
  dot = false,
  className,
  children,
  ...rest
}: BadgeProps) {
  return (
    <span
      className={cn(styles.badge, styles[tone], styles[size], className)}
      {...rest}
    >
      {dot && <span className={styles.dot} aria-hidden="true" />}
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------------- */

export type StatusKind =
  | "online"
  | "offline"
  | "pending"
  | "active"
  | "inactive"
  | "warning";

const STATUS_TONE: Record<StatusKind, BadgeTone> = {
  online: "success",
  active: "success",
  offline: "error",
  inactive: "neutral",
  pending: "warning",
  warning: "warning",
};

export interface StatusBadgeProps extends Omit<BadgeProps, "tone" | "dot"> {
  status: StatusKind;
  /** Texto visible; si se omite se usa `children`. */
  label?: string;
}

export function StatusBadge({
  status,
  label,
  size = "md",
  className,
  children,
  ...rest
}: StatusBadgeProps) {
  return (
    <Badge
      tone={STATUS_TONE[status]}
      size={size}
      dot
      className={className}
      {...rest}
    >
      {label ?? children}
    </Badge>
  );
}
