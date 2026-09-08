/**
 * EFAAT — base de componentes visuales reutilizables.
 * Puramente presentacionales: sin llamadas a APIs, Supabase ni lógica de negocio.
 */
export { cn } from "./cn";
export type { ClassValue } from "./cn";

export { Button } from "./Button";
export type { ButtonProps, ButtonVariant, ButtonSize } from "./Button";

export { IconButton } from "./IconButton";
export type {
  IconButtonProps,
  IconButtonVariant,
  IconButtonSize,
} from "./IconButton";

export { Card } from "./Card";
export type { CardProps, CardPadding } from "./Card";

export { Badge, StatusBadge } from "./Badge";
export type {
  BadgeProps,
  BadgeTone,
  BadgeSize,
  StatusBadgeProps,
  StatusKind,
} from "./Badge";

export { Field } from "./Field";
export type { FieldProps } from "./Field";

export { Input } from "./Input";
export type { InputProps } from "./Input";

export { Select } from "./Select";
export type { SelectProps } from "./Select";

export { Textarea } from "./Textarea";
export type { TextareaProps } from "./Textarea";

export { Tabs } from "./Tabs";
export type { TabsProps, TabItem } from "./Tabs";

export { Modal } from "./Modal";
export type { ModalProps, ModalSize } from "./Modal";

export { EmptyState } from "./EmptyState";
export type { EmptyStateProps } from "./EmptyState";

export { Skeleton } from "./Skeleton";
export type { SkeletonProps } from "./Skeleton";

export { PageHeader } from "./PageHeader";
export type { PageHeaderProps } from "./PageHeader";

export { SectionHeader } from "./SectionHeader";
export type { SectionHeaderProps } from "./SectionHeader";

export { StatCard } from "./StatCard";
export type { StatCardProps, StatCardTone } from "./StatCard";
