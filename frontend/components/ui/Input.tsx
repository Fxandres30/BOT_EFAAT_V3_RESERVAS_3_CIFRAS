"use client";

import { forwardRef, useId } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";

import { cn } from "./cn";
import { Field } from "./Field";
import styles from "./controls.module.css";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  optional?: boolean;
  leftIcon?: ReactNode;
  /** clase para el contenedor `Field` */
  fieldClassName?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    hint,
    error,
    optional,
    leftIcon,
    id,
    className,
    fieldClassName,
    ...rest
  },
  ref
) {
  const autoId = useId();
  const inputId = id ?? autoId;

  const control = (
    <input
      ref={ref}
      id={inputId}
      aria-invalid={error ? true : undefined}
      className={cn(
        styles.control,
        styles.line,
        !!leftIcon && styles.withLeftIcon,
        className
      )}
      {...rest}
    />
  );

  return (
    <Field
      htmlFor={inputId}
      label={label}
      hint={hint}
      error={error}
      optional={optional}
      className={fieldClassName}
    >
      {leftIcon ? (
        <span className={styles.inputWrap}>
          <span className={styles.leftIcon} aria-hidden="true">
            {leftIcon}
          </span>
          {control}
        </span>
      ) : (
        control
      )}
    </Field>
  );
});
