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
        "bg-[var(--color-coin)] bg-opacity-15 text-[var(--color-coin)]",
        className
      )}
    >
      New
    </Badge>
  );
}

export function LiveBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-600",
        className
      )}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
      LIVE
    </span>
  );
}

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const styles: Record<string, string> = {
    open: "bg-emerald-50 text-emerald-700",
    closed: "bg-gray-100 text-gray-600",
    resolved_yes: "bg-emerald-50 text-emerald-700",
    resolved_no: "bg-red-50 text-red-700",
    cancelled: "bg-gray-100 text-gray-500",
    pending: "bg-amber-50 text-amber-700",
    approved: "bg-emerald-50 text-emerald-700",
    rejected: "bg-red-50 text-red-700",
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
    <Badge className={cn(styles[status] ?? "bg-gray-100 text-gray-600", className)}>
      {labels[status] ?? status}
    </Badge>
  );
}
