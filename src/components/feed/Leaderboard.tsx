import Link from "next/link";
import { Avatar } from "@/components/ui/Avatar";
import { formatCoins, formatWinRate, formatDisplayName } from "@/lib/utils";
import type { Profile } from "@/types/database";

type LeaderboardUser = Pick<
  Profile,
  "id" | "username" | "display_name" | "avatar_url" | "coins" | "wins" | "total_bets"
>;

interface LeaderboardProps {
  users: LeaderboardUser[];
}

const MEDALS = ["🥇", "🥈", "🥉"];

export function Leaderboard({ users }: LeaderboardProps) {
  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{
        backgroundColor: "var(--color-bg-card)",
        border: "1px solid var(--color-border)",
        boxShadow: "var(--shadow-card)",
      }}
    >
      <div
        className="px-4 py-3"
        style={{ borderBottom: "1px solid var(--color-border)" }}
      >
        <h2
          className="font-semibold text-sm"
          style={{ color: "var(--color-ink-primary)" }}
        >
          Leaderboard
        </h2>
      </div>

      <ul>
        {users.map((user, index) => (
          <li
            key={user.id}
            className="transition-colors duration-150 hover:bg-[var(--color-bg-hover)]"
            style={{
              borderBottom:
                index < users.length - 1
                  ? "1px solid var(--color-border)"
                  : undefined,
            }}
          >
            <Link
              href={`/profile/${user.username ?? ""}`}
              className="flex items-center gap-3 px-4 py-3"
            >
              {/* Rank */}
              <span
                className="w-6 text-center text-sm flex-shrink-0"
                aria-label={`Rank ${index + 1}`}
              >
                {index < 3 ? MEDALS[index] : (
                  <span
                    className="font-bold text-xs"
                    style={{ color: "var(--color-ink-tertiary)" }}
                  >
                    {index + 1}
                  </span>
                )}
              </span>

              {/* Avatar */}
              <Avatar
                src={user.avatar_url}
                displayName={user.display_name}
                username={user.username}
                size="sm"
              />

              {/* Name + stats */}
              <div className="flex-1 min-w-0">
                <p
                  className="text-sm font-medium truncate"
                  style={{ color: "var(--color-ink-primary)" }}
                >
                  {formatDisplayName(user.display_name, user.username)}
                </p>
                <p
                  className="text-xs"
                  style={{ color: "var(--color-ink-tertiary)" }}
                >
                  {formatWinRate(user.wins, user.total_bets)} win rate
                </p>
              </div>

              {/* Coins */}
              <div className="text-right flex-shrink-0">
                <span
                  className="text-sm font-bold"
                  style={{ color: "var(--color-ink-primary)" }}
                >
                  {formatCoins(user.coins)}
                </span>
                <p
                  className="text-xs"
                  style={{ color: "var(--color-coin)" }}
                >
                  coins
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
