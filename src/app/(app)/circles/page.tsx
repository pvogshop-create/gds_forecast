import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/auth";
import { CircleCard } from "@/components/circles/CircleCard";
import { JoinCircleButton } from "./JoinCircleButton";
import type { Circle, CircleMember } from "@/types/database";

export default async function CirclesPage() {
  const user = await requireAuth();
  const supabase = await createClient();

  const { data: memberships, error: membershipError } = await supabase
    .from("circle_members")
    .select("circle_id, role")
    .eq("user_id", user.id);

  const myRoles = new Map(
    (memberships ?? []).map((m: Pick<CircleMember, "circle_id" | "role">) => [
      m.circle_id,
      m.role,
    ])
  );

  // One query, not two: circles_select already returns exactly the circles this
  // user may see — the ones they belong to plus every open circle — so filtering
  // by membership client-side would just re-derive what RLS already decided.
  const { data, error } = await supabase
    .from("circles")
    .select("*")
    .order("member_count", { ascending: false });

  // An RLS-filtered read returns `[]` with no error, and that is the normal
  // "you're in no circles" case. A genuine error is something else entirely —
  // a missing table (no 0029 here), or a recursive policy (42P17, the 0024
  // bug) — and must not be laundered into the same empty state. Conflating
  // them is precisely how the leagues outage stayed invisible for months.
  const failure = error ?? membershipError;
  if (failure) {
    throw new Error(
      `Could not load circles: ${failure.message} (${failure.code}). ` +
        `A missing relation means this database has not had migration 0029 applied; ` +
        `42P17 would mean a circle policy has become recursive.`
    );
  }

  const circles = (data ?? []) as Circle[];
  const mine = circles.filter((c) => myRoles.has(c.id));
  const discoverable = circles.filter((c) => !myRoles.has(c.id));

  return (
    <div>
      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold" style={{ color: "var(--color-ink-primary)" }}>
            Circles
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--color-ink-secondary)" }}>
            Your school, camp or team — and the markets only they can see.
          </p>
        </div>
        <JoinCircleButton />
      </div>

      {mine.length === 0 ? (
        <div
          className="rounded-xl p-8 text-center"
          style={{
            backgroundColor: "var(--color-bg-card)",
            border: "1px solid var(--color-border)",
          }}
          data-testid="circles-empty"
        >
          <div className="text-4xl mb-3">🎓</div>
          <p
            className="font-medium text-sm mb-2"
            style={{ color: "var(--color-ink-primary)" }}
          >
            You haven&apos;t joined any circles yet.
          </p>
          <p className="text-xs" style={{ color: "var(--color-ink-tertiary)" }}>
            Join one with an invite code from someone already in it.
          </p>
        </div>
      ) : (
        <div className="space-y-3" data-testid="circles-mine">
          {mine.map((circle) => (
            <CircleCard key={circle.id} circle={circle} role={myRoles.get(circle.id)} />
          ))}
        </div>
      )}

      {discoverable.length > 0 && (
        <section className="mt-6">
          <h2
            className="text-sm font-semibold mb-3"
            style={{ color: "var(--color-ink-secondary)" }}
          >
            Open to join
          </h2>
          <div className="space-y-3" data-testid="circles-discoverable">
            {discoverable.map((circle) => (
              <CircleCard key={circle.id} circle={circle} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
