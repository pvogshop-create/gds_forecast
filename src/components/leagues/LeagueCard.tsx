import Link from "next/link";
import { Users } from "lucide-react";
import type { League } from "@/types/database";

interface LeagueCardProps {
  league: League;
  memberCount?: number;
  userRank?: number;
}

export function LeagueCard({ league, memberCount = 0, userRank }: LeagueCardProps) {
  return (
    <Link
      href={`/leagues/${league.id}`}
      className="block group"
      data-testid="league-card"
      data-league-id={league.id}
      data-member-count={memberCount}
    >
      <div
        className="rounded-xl p-4 transition-all duration-200 hover:shadow-[var(--shadow-card-hover)]"
        style={{
          backgroundColor: "var(--color-bg-card)",
          border: "1px solid var(--color-border)",
          boxShadow: "var(--shadow-card)",
        }}
      >
        <div className="flex items-start gap-3">
          {/* League avatar */}
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-white font-bold text-sm"
            style={{ backgroundColor: "var(--color-primary)" }}
          >
            {league.name.slice(0, 2).toUpperCase()}
          </div>

          <div className="flex-1 min-w-0">
            <h3
              className="font-semibold text-sm truncate group-hover:underline"
              style={{
                color: "var(--color-ink-primary)",
                textDecorationColor: "var(--color-primary)",
              }}
            >
              {league.name}
            </h3>
            {league.description && (
              <p
                className="text-xs truncate mt-0.5"
                style={{ color: "var(--color-ink-tertiary)" }}
              >
                {league.description}
              </p>
            )}
          </div>

          {userRank && (
            <span
              className="text-xs font-bold px-2 py-1 rounded-lg flex-shrink-0"
              style={{
                backgroundColor: "var(--color-primary-light)",
                color: "var(--color-primary)",
              }}
            >
              #{userRank}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 mt-3">
          <Users
            size={12}
            style={{ color: "var(--color-ink-tertiary)" }}
            strokeWidth={2}
          />
          <span
            className="text-xs"
            style={{ color: "var(--color-ink-tertiary)" }}
          >
            {memberCount} / {league.max_members} members
          </span>
        </div>
      </div>
    </Link>
  );
}
