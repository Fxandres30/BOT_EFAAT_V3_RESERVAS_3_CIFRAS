import { forwardRef } from "react";
import type { HTMLAttributes } from "react";

import { cn } from "./cn";
import styles from "./Card.module.css";

export type CardPadding = "none" | "sm" | "md" | "lg";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: CardPadding;
  interactive?: boolean;
}

const padClass: Record<CardPadding, string> = {
  none: styles.padNone,
  sm: styles.padSm,
  md: styles.padMd,
  lg: styles.padLg,
};

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { padding = "md", interactive = false, className, children, ...rest },
  ref
) {
  return (
    <div
      ref={ref}
      className={cn(
        styles.card,
        padClass[padding],
        interactive && styles.interactive,
        className
      )}
      {...rest}
    >
      {children}
    </div>
  );
});
