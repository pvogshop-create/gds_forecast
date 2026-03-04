import { cn, getInitials } from "@/lib/utils";

interface AvatarProps {
  src?: string | null;
  displayName?: string | null;
  username?: string | null;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}

const SIZES = {
  xs: "w-6 h-6 text-[10px]",
  sm: "w-8 h-8 text-xs",
  md: "w-10 h-10 text-sm",
  lg: "w-14 h-14 text-base",
} as const;

export function Avatar({
  src,
  displayName,
  username,
  size = "md",
  className,
}: AvatarProps) {
  const initials = getInitials(displayName ?? null, username ?? null);

  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={`${displayName ?? username ?? "User"}'s avatar`}
        className={cn("rounded-full object-cover flex-shrink-0", SIZES[size], className)}
        width={56}
        height={56}
      />
    );
  }

  return (
    <div
      className={cn(
        "rounded-full flex items-center justify-center font-semibold text-white flex-shrink-0",
        SIZES[size],
        className
      )}
      style={{ backgroundColor: "var(--color-primary)" }}
      aria-label={`${displayName ?? username ?? "User"}'s avatar`}
    >
      {initials}
    </div>
  );
}
