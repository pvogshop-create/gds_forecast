import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/auth";
import { LeagueCard } from "@/components/leagues/LeagueCard";
import { CreateLeagueButton } from "./CreateLeagueButton";
import { JoinLeagueButton } from "./JoinLeagueButton";
import type { League, LeagueMember } from "@/types/database";

export default async function LeaguesPage() {
  const user = await requireAuth();
  const supabase = await createClient();

  // Get leagues the user belongs to
  const { data: memberships } = await supabase
    .from("league_members")
    .select("league_id, role")
    .eq("user_id", user.id);

  const leagueIds = (memberships ?? []).map((m: Pick<LeagueMember, "league_id" | "role">) => m.league_id);

  const [leaguesResult, memberCountsResult] = await Promise.all([
    leagueIds.length > 0
      ? supabase.from("leagues").select("*").in("id", leagueIds)
      : Promise.resolve({ data: [] }),

    leagueIds.length > 0
      ? supabase
          .from("league_members")
          .select("league_id")
          .in("league_id", leagueIds)
      : Promise.resolve({ data: [] }),
  ]);

  const leagues = (leaguesResult.data ?? []) as League[];

  // Count members per league
  const memberCounts: Record<string, number> = {};
  for (const row of memberCountsResult.data ?? []) {
    const r = row as { league_id: string };
    memberCounts[r.league_id] = (memberCounts[r.league_id] ?? 0) + 1;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1
          className="text-xl font-bold"
          style={{ color: "var(--color-ink-primary)" }}
        >
          Leagues
        </h1>
        <div className="flex gap-2">
          <JoinLeagueButton />
          <CreateLeagueButton userId={user.id} />
        </div>
      </div>

      {leagues.length === 0 ? (
        <div
          className="rounded-xl p-8 text-center"
          style={{
            backgroundColor: "var(--color-bg-card)",
            border: "1px solid var(--color-border)",
          }}
        >
          <div className="text-4xl mb-3">🏆</div>
          <p
            className="font-medium text-sm mb-2"
            style={{ color: "var(--color-ink-primary)" }}
          >
            You haven&apos;t joined any leagues yet.
          </p>
          <p
            className="text-xs"
            style={{ color: "var(--color-ink-tertiary)" }}
          >
            Create a league or join one with an invite code.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {leagues.map((league) => (
            <LeagueCard
              key={league.id}
              league={league}
              memberCount={memberCounts[league.id] ?? 0}
            />
          ))}
        </div>
      )}
    </div>
  );
}
