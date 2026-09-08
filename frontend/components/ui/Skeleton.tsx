import type { CSSProperties } from "react";

import { cn } from "./cn";
import styles from "./Skeleton.module.css";

export interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  circle?: boolean;
  /** Preajuste para líneas de texto (alto fijo). */
  text?: boolean;
  className?: string;
  style?: CSSProperties;
}

export function Skeleton({
  width,
  height,
  radius,
  circle = false,
  text = false,
  className,
  style,
}: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        styles.skeleton,
        circle && styles.circle,
        text && styles.text,
        className
      )}
      style={{
        width,
        height,
        borderRadius: radius,
        ...style,
      }}
    />
  );
}
