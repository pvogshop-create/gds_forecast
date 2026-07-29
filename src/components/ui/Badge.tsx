import { Clock } from "lucide-react";
import { cn, getCategoryColors, getCategoryLabel } from "@/lib/utils";
import type { MarketCategory } from "@/types/database";

interface BadgeProps {
  children: React.ReactNode;
  className?: string;
}

export function Badge({ children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium",
        className
      )}
    >
      {children}
    </span>
  );
}

interface CategoryBadgeProps {
  category: MarketCategory;
  className?: string;
}

export function CategoryBadge({ category, className }: CategoryBadgeProps) {
  const { bg, text } = getCategoryColors(category);
  return (
    <Badge className={cn(bg, text, className)}>
      {getCategoryLabel(category)}
    </Badge>
  );
}

export function NewBadge({ className }: { className?: string }) {
  return (
    <Badge
      className={cn(
        // Tailwind v4 removed bg-opacity-*; the slash modifier is the replacement.
        "bg-[var(--color-coin)]/15 text-[var(--color-coin)]",
        className
      )}
    >
      New
    </Badge>
  );
}

export function ClosingSoonBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium",
        "bg-[var(--color-warning)]/12 text-[var(--color-warning)]",
        className
      )}
    >
      <Clock size={10} strokeWidth={2.5} />
      CLOSING SOON
    </span>
  );
}

export function LiveBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium",
        "bg-[var(--color-danger)]/10 text-[var(--color-danger)]",
        className
      )}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-danger)] animate-pulse" />
      LIVE
    </span>
  );
}

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  // Green / red / amber here are load-bearing: they encode outcome, not brand.
  // Neutral states use greys so they read as "no outcome yet".
  const SUCCESS = "bg-[var(--color-success)]/12 text-[var(--color-success)]";
  const DANGER = "bg-[var(--color-danger)]/10 text-[var(--color-danger)]";
  const WARNING = "bg-[var(--color-warning)]/12 text-[var(--color-warning)]";
  const NEUTRAL = "bg-neutral-100 text-neutral-600";

  const styles: Record<string, string> = {
    open: SUCCESS,
    closed: NEUTRAL,
    resolved_yes: SUCCESS,
    resolved_no: DANGER,
    cancelled: "bg-neutral-100 text-neutral-500",
    pending: WARNING,
    approved: SUCCESS,
    rejected: DANGER,
  };

  const labels: Record<string, string> = {
    open: "Open",
    closed: "Closed",
    resolved_yes: "Resolved YES",
    resolved_no: "Resolved NO",
    cancelled: "Cancelled",
    pending: "Pending",
    approved: "Approved",
    rejected: "Rejected",
  };

  return (
    <Badge className={cn(styles[status] ?? NEUTRAL, className)}>
      {labels[status] ?? status}
    </Badge>
  );
}
