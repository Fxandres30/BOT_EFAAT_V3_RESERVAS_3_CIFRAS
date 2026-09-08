"use client";

import { forwardRef, useId } from "react";
import type { SelectHTMLAttributes, ReactNode } from "react";

import { cn } from "./cn";
import { Field } from "./Field";
import styles from "./controls.module.css";

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  optional?: boolean;
  fieldClassName?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, optional, id, className, fieldClassName, children, ...rest },
  ref
) {
  const autoId = useId();
  const selectId = id ?? autoId;

  return (
    <Field
      htmlFor={selectId}
      label={label}
      hint={hint}
      error={error}
      optional={optional}
      className={fieldClassName}
    >
      <select
        ref={ref}
        id={selectId}
        aria-invalid={error ? true : undefined}
        className={cn(styles.control, styles.line, styles.select, className)}
        {...rest}
      >
        {children}
      </select>
    </Field>
  );
});
