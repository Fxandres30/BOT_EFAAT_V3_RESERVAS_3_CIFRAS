"use client";

import { useCallback, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { X } from "lucide-react";

import { cn } from "./cn";
import styles from "./Modal.module.css";

export type ModalSize = "sm" | "md" | "lg";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  size?: ModalSize;
  /** Cerrar al hacer clic fuera. Por defecto true. */
  closeOnBackdrop?: boolean;
  /** Mostrar la X. Por defecto true. */
  showClose?: boolean;
  footer?: ReactNode;
  children?: ReactNode;
  className?: string;
}

export function Modal({
  open,
  onClose,
  title,
  description,
  size = "md",
  closeOnBackdrop = true,
  showClose = true,
  footer,
  children,
  className,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const labelId = useId();
  const descId = useId();

  const handleClose = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    if (!open) return;

    previousFocus.current = document.activeElement as HTMLElement | null;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        handleClose();
      }
    };

    document.addEventListener("keydown", onKeyDown);

    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    // Enfocar el diálogo al abrir.
    const raf = requestAnimationFrame(() => {
      dialogRef.current?.focus();
    });

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = overflow;
      cancelAnimationFrame(raf);
      previousFocus.current?.focus?.();
    };
  }, [open, handleClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className={styles.overlay}
      onMouseDown={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) {
          handleClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? labelId : undefined}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={cn(styles.modal, styles[size], className)}
      >
        {(title || showClose) && (
          <div className={styles.header}>
            <div className={styles.titleBox}>
              {title && (
                <h2 id={labelId} className={styles.title}>
                  {title}
                </h2>
              )}
              {description && (
                <p id={descId} className={styles.description}>
                  {description}
                </p>
              )}
            </div>
            {showClose && (
              <button
                type="button"
                className={styles.close}
                aria-label="Cerrar"
                onClick={handleClose}
              >
                <X size={18} />
              </button>
            )}
          </div>
        )}

        {children != null && <div className={styles.body}>{children}</div>}

        {footer && <div className={styles.footer}>{footer}</div>}
      </div>
    </div>,
    document.body
  );
}
