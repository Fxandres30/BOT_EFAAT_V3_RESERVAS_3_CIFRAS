import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cn } from "./cn";
import { Spinner } from "./Spinner";
import styles from "./IconButton.module.css";

export type IconButtonVariant = "ghost" | "solid" | "danger";
export type IconButtonSize = "sm" | "md";

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> {
  /** Obligatorio: texto accesible del botón de icono. */
  label: string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  /** En curso: muestra el indicador común en lugar del icono y no admite clics. */
  loading?: boolean;
  children: ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    {
      label,
      variant = "ghost",
      size = "md",
      loading = false,
      disabled,
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
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={cn(
          styles.iconButton,
          styles[variant],
          styles[size],
          className
        )}
        {...rest}
      >
        {loading ? <Spinner size={size === "sm" ? 13 : 15} /> : children}
      </button>
    );
  }
);
