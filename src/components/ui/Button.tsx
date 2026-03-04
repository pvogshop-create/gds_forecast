import { cn } from "@/lib/utils";
import type { ButtonHTMLAttributes } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "yes" | "no";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  children: React.ReactNode;
}

const BASE =
  "inline-flex items-center justify-center font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed select-none";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-[var(--color-btn)] text-white hover:bg-[var(--color-btn-hover)] active:scale-[0.98] focus-visible:ring-[var(--color-primary)] rounded-full",
  secondary:
    "bg-transparent text-[var(--color-primary)] border border-[var(--color-primary)] hover:bg-[var(--color-primary-light)] active:scale-[0.98] focus-visible:ring-[var(--color-primary)] rounded-full",
  ghost:
    "bg-transparent text-[var(--color-ink-secondary)] hover:bg-[var(--color-bg-hover)] active:scale-[0.98] focus-visible:ring-[var(--color-primary)] rounded-xl",
  danger:
    "bg-[var(--color-danger)] text-white hover:opacity-90 active:scale-[0.98] focus-visible:ring-[var(--color-danger)] rounded-full",
  yes: "bg-[var(--color-yes-bg)] text-[var(--color-yes)] hover:bg-[var(--color-primary)] hover:text-white active:scale-[0.98] focus-visible:ring-[var(--color-primary)] rounded-xl font-bold border border-[var(--color-yes)] border-opacity-30",
  no: "bg-[var(--color-no-bg)] text-[var(--color-no)] hover:bg-[var(--color-danger)] hover:text-white active:scale-[0.98] focus-visible:ring-[var(--color-danger)] rounded-xl font-bold border border-[var(--color-no)] border-opacity-30",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "text-xs px-3 py-1.5 gap-1.5",
  md: "text-sm px-4 py-2.5 gap-2",
  lg: "text-base px-6 py-3 gap-2.5",
};

export function Button({
  variant = "primary",
  size = "md",
  isLoading = false,
  disabled,
  children,
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      disabled={disabled || isLoading}
      className={cn(BASE, VARIANTS[variant], SIZES[size], className)}
      {...props}
    >
      {isLoading ? (
        <>
          <span
            className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin"
            aria-hidden="true"
          />
          <span>Loading…</span>
        </>
      ) : (
        children
      )}
    </button>
  );
}
