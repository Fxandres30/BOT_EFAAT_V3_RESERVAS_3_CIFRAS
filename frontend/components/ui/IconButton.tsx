import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cn } from "./cn";
import styles from "./IconButton.module.css";

export type IconButtonVariant = "ghost" | "solid" | "danger";
export type IconButtonSize = "sm" | "md";

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> {
  /** Obligatorio: texto accesible del botón de icono. */
  label: string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  children: ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    {
      label,
      variant = "ghost",
      size = "md",
      className,
      children,
      type = "button",
      ...rest
    },
    ref
  ) {
    return (
      <button
        ref={ref}
        type={type}
        aria-label={label}
        title={label}
        className={cn(
          styles.iconButton,
          styles[variant],
          styles[size],
          className
        )}
        {...rest}
      >
        {children}
      </button>
    );
  }
);
