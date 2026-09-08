"use client";

import { forwardRef, useId } from "react";
import type { TextareaHTMLAttributes, ReactNode } from "react";

import { cn } from "./cn";
import { Field } from "./Field";
import styles from "./controls.module.css";

export interface TextareaProps
  extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  optional?: boolean;
  fieldClassName?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea(
    { label, hint, error, optional, id, className, fieldClassName, rows = 4, ...rest },
    ref
  ) {
    const autoId = useId();
    const areaId = id ?? autoId;

    return (
      <Field
        htmlFor={areaId}
        label={label}
        hint={hint}
        error={error}
        optional={optional}
        className={fieldClassName}
      >
        <textarea
          ref={ref}
          id={areaId}
          rows={rows}
          aria-invalid={error ? true : undefined}
          className={cn(styles.control, styles.area, className)}
          {...rest}
        />
      </Field>
    );
  }
);
