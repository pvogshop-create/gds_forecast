import Link from "next/link";
import { Avatar } from "@/components/ui/Avatar";
import { formatRelativeTime, formatCoins, formatDisplayName } from "@/lib/utils";
import type { ActivityFeedEntryWithProfile } from "@/types/database";

interface ActivityFeedItemProps {
  entry: ActivityFeedEntryWithProfile;
}

function getActionDescription(
  entry: ActivityFeedEntryWithProfile
): { text: string; emoji: string } {
  const marketTitle = entry.markets?.title ?? "a market";
  const data = entry.data ?? {};
  const coins =
    typeof data["coins_wagered"] === "number" ? data["coins_wagered"] : null;

  switch (entry.action_type) {
    case "bet_yes":
      return {
        emoji: "📈",
        text: `bet YES${coins ? ` ${formatCoins(coins)} coins` : ""} on "${marketTitle}"`,
      };
    case "bet_no":
      return {
        emoji: "📉",
        text: `bet NO${coins ? ` ${formatCoins(coins)} coins` : ""} on "${marketTitle}"`,
      };
    case "market_won": {
      const payout =
        typeof data["payout"] === "number" ? data["payout"] : null;
      return {
        emoji: "🎉",
        text: `won${payout ? ` ${formatCoins(payout)} coins` : ""} on "${marketTitle}"`,
      };
    }
    case "league_joined":
      return { emoji: "🤝", text: "joined a league" };
    case "league_created":
      return { emoji: "🏆", text: "created a league" };
    default:
      return { emoji: "✨", text: entry.action_type.replace(/_/g, " ") };
  }
}

export function ActivityFeedItem({ entry }: ActivityFeedItemProps) {
  const { text, emoji } = getActionDescription(entry);
  const profile = entry.profiles;
  const username = profile?.username ?? "unknown";

  return (
    <div className="flex items-start gap-3 px-4 py-3 hover:bg-[var(--color-bg-hover)] transition-colors duration-150">
      <Link href={`/profile/${username}`} className="flex-shrink-0">
        <Avatar
          src={profile?.avatar_url}
          displayName={profile?.display_name}
          username={username}
          size="sm"
        />
      </Link>

      <div className="flex-1 min-w-0">
        <p
          className="text-sm leading-snug"
          style={{ color: "var(--color-ink-primary)" }}
        >
          <Link
            href={`/profile/${username}`}
            className="font-semibold hover:underline"
            style={{ textDecorationColor: "var(--color-primary)" }}
          >
            {formatDisplayName(profile?.display_name, profile?.username)}
          </Link>{" "}
          <span className="mr-1">{emoji}</span>
          {entry.market_id ? (
            <Link
              href={`/market/${entry.market_id}`}
              className="hover:underline"
              style={{
                color: "var(--color-ink-secondary)",
                textDecorationColor: "var(--color-primary)",
              }}
            >
              {text}
            </Link>
          ) : (
            <span style={{ color: "var(--color-ink-secondary)" }}>{text}</span>
          )}
        </p>
        <time
          className="text-xs"
          style={{ color: "var(--color-ink-tertiary)" }}
          dateTime={entry.created_at}
        >
          {formatRelativeTime(entry.created_at)}
        </time>
      </div>
    </div>
  );
}
