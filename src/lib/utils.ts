import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { MarketCategory } from "@/types/database";

// Merge Tailwind classes safely (handles conflicts)
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Format a coin amount with thousands separator
export function formatCoins(coins: number): string {
  return coins.toLocaleString("en-US");
}

// Format probability as percentage string (e.g., 0.65 → "65%")
export function formatProbability(p: number): string {
  return `${Math.round(p * 100)}%`;
}

// Format probability as cents string (e.g., 0.65 → "65¢")
export function formatCents(p: number): string {
  return `${Math.round(p * 100)}¢`;
}

// Format time remaining until a date
export function formatTimeRemaining(dateStr: string | null): string {
  if (!dateStr) return "No expiry";
  const diff = new Date(dateStr).getTime() - Date.now();
  if (diff < 0) return "Expired";

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;

  if (days >= 30) {
    const months = Math.floor(days / 30);
    return `${months}mo`;
  }
  if (days >= 1) return `${days}d ${remainingHours}h`;
  return `${hours}h`;
}

// Format a date as relative time (e.g., "2 hours ago")
export function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "just now";
}

// Check if a market is "new" (created within 6 hours)
export function isNewMarket(createdAt: string): boolean {
  const diff = Date.now() - new Date(createdAt).getTime();
  return diff < 6 * 60 * 60 * 1000;
}

// Get display label for a market category
export function getCategoryLabel(category: MarketCategory): string {
  const labels: Record<MarketCategory, string> = {
    sports: "Sports",
    social: "Social",
    actions: "Actions",
  };
  return labels[category];
}

// Get Tailwind color classes for a market category badge.
// Brand palette is black / white / purple, so categories are distinguished by
// depth within one hue rather than by different hues. Red, green, and amber are
// reserved for meaning (NO, win/loss, coins) and must not appear here.
export function getCategoryColors(category: MarketCategory): {
  bg: string;
  text: string;
} {
  const colors: Record<MarketCategory, { bg: string; text: string }> = {
    sports: { bg: "bg-violet-100", text: "text-violet-900" },
    actions: { bg: "bg-violet-50", text: "text-violet-700" },
    social: { bg: "bg-purple-50", text: "text-purple-600" },
  };
  return colors[category];
}

// Generate user initials from display_name or username
export function getInitials(
  displayName: string | null,
  username: string | null
): string {
  const name = displayName ?? username ?? "?";
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

// Format win rate as percentage
export function formatWinRate(wins: number, totalBets: number): string {
  if (totalBets === 0) return "—";
  return `${Math.round((wins / totalBets) * 100)}%`;
}

// Resolve a user's display name, stripping email domain from username if no display_name is set
export function formatDisplayName(
  displayName: string | null | undefined,
  username: string | null | undefined
): string {
  if (displayName) return displayName;
  if (!username) return "Unknown";
  // If the username looks like an email (e.g. john.doe@example.com), show only the local part
  return username.includes("@") ? (username.split("@")[0] ?? username) : username;
}
