import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { AdminMarkets } from "./AdminMarkets";
import { AdminSuggestions } from "./AdminSuggestions";
import { AdminUsers } from "./AdminUsers";
import { AdminCreateMarket } from "./AdminCreateMarket";
import { AdminCreateCircle } from "./AdminCreateCircle";
import { AdminIncidents } from "./AdminIncidents";
import Link from "next/link";
import type { Circle, Market, MarketSuggestion, Profile, IncidentReportWithMarket } from "@/types/database";

const TABS = [
  { id: "suggestions", label: "Suggestions" },
  { id: "create", label: "Create" },
  { id: "markets", label: "Markets" },
  { id: "circles", label: "Circles" },
  { id: "users", label: "Users" },
  { id: "incidents", label: "Incidents" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab: rawTab } = await searchParams;
  const tab: TabId =
    rawTab === "create" ||
    rawTab === "markets" ||
    rawTab === "circles" ||
    rawTab === "users" ||
    rawTab === "incidents"
      ? rawTab
      : "suggestions";

  const adminUser = await requireAdmin();
  const admin = createAdminClient();

  // Fetch admin profile for display name
  const { data: adminProfile } = await admin
    .from("profiles")
    .select("display_name, username")
    .eq("id", adminUser.id)
    .maybeSingle();
  const adminDisplayName =
    adminProfile?.display_name ??
    adminProfile?.username ??
    adminUser.email;

  // Fetch data only for the active tab
  let markets: Market[] = [];
  let suggestions: Array<MarketSuggestion & { profiles: Pick<Profile, "username" | "avatar_url"> | null }> = [];
  let users: Pick<Profile, "id" | "username" | "display_name" | "avatar_url" | "coins" | "total_bets" | "wins">[] = [];
  let incidentReports: IncidentReportWithMarket[] = [];
  let circles: Circle[] = [];

  if (tab === "suggestions") {
    const { data } = await admin
      .from("market_suggestions")
      .select("*, profiles:user_id (username, avatar_url)")
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    suggestions = (data ?? []) as typeof suggestions;
  } else if (tab === "markets") {
    const { data } = await admin
      .from("markets")
      .select("*")
      .in("status", ["open", "closed"])
      .order("created_at", { ascending: false })
      .limit(50);
    markets = (data ?? []) as Market[];
  } else if (tab === "circles") {
    // Through the admin client, so this listing shows EVERY circle. A normal
    // session would only see the ones it belongs to plus open ones — correct
    // for /circles, useless for administering them.
    const { data, error } = await admin
      .from("circles")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);

    // Do NOT fall back to [] here. If the table is missing — an environment
    // without 0029 — an empty array renders "No circles yet", which is a
    // different and wrong statement: it says the query worked and found none.
    // Silent-empty is how a whole feature looks healthy while being broken.
    if (error) {
      throw new Error(
        `Could not read circles: ${error.message} (${error.code}). ` +
          `If this is "relation does not exist", the database this app is pointed ` +
          `at has not had migration 0029 applied.`
      );
    }
    circles = (data ?? []) as Circle[];
  } else if (tab === "users") {
    const { data } = await admin
      .from("profiles")
      .select("id, username, display_name, avatar_url, coins, total_bets, wins")
      .not("username", "is", null)
      .order("coins", { ascending: false })
      .limit(50);
    users = (data ?? []) as typeof users;
  } else if (tab === "incidents") {
    const { data } = await admin
      .from("incident_reports")
      .select("*, markets (id, title, category, status, market_type), incident_votes (user_id, agrees)")
      .in("status", ["voting", "passed"])
      .order("created_at", { ascending: false })
      .limit(50);
    incidentReports = (data ?? []) as IncidentReportWithMarket[];
  }

  // Badge counts (always fetched — lightweight)
  const [{ count: suggestionCount }, { count: marketCount }, { count: incidentCount }] =
    await Promise.all([
      admin
        .from("market_suggestions")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending"),
      admin
        .from("markets")
        .select("id", { count: "exact", head: true })
        .in("status", ["open", "closed"]),
      admin
        .from("incident_reports")
        .select("id", { count: "exact", head: true })
        .in("status", ["voting", "passed"]),
    ]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <h1
            className="text-xl font-bold"
            style={{ color: "var(--color-ink-primary)" }}
          >
            Admin Dashboard
          </h1>
          <span
            className="text-xs px-2 py-0.5 rounded-full font-medium"
            style={{
              backgroundColor: "var(--color-coin)",
              color: "white",
            }}
          >
            Admin
          </span>
        </div>
        <p
          className="text-sm"
          style={{ color: "var(--color-ink-secondary)" }}
        >
          Signed in as {adminDisplayName}
        </p>
      </div>

      {/* Tab bar */}
      <nav
        className="flex gap-1 rounded-xl p-1"
        style={{ backgroundColor: "var(--color-bg-card)", border: "1px solid var(--color-border)" }}
        aria-label="Admin sections"
      >
        {TABS.map((t) => {
          const isActive = tab === t.id;
          const badge =
            t.id === "suggestions" && (suggestionCount ?? 0) > 0
              ? suggestionCount
              : t.id === "markets" && (marketCount ?? 0) > 0
              ? marketCount
              : t.id === "incidents" && (incidentCount ?? 0) > 0
              ? incidentCount
              : null;
          return (
            <Link
              key={t.id}
              data-testid="admin-tab"
              data-tab={t.id}
              data-active={isActive}
              href={`/admin?tab=${t.id}`}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-150 flex-1 justify-center"
              style={{
                backgroundColor: isActive
                  ? "var(--color-bg)"
                  : "transparent",
                color: isActive
                  ? "var(--color-ink-primary)"
                  : "var(--color-ink-secondary)",
                boxShadow: isActive ? "var(--shadow-card)" : "none",
              }}
              aria-current={isActive ? "page" : undefined}
            >
              {t.label}
              {badge !== null && (
                <span
                  className="px-1.5 py-0.5 rounded-full text-xs font-semibold leading-none"
                  style={{
                    backgroundColor: t.id === "suggestions"
                      ? "var(--color-warning)"
                      : "var(--color-primary)",
                    color: "white",
                  }}
                >
                  {badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Active tab content */}
      {tab === "suggestions" && (
        <AdminSuggestions suggestions={suggestions} />
      )}
      {tab === "create" && <AdminCreateMarket />}
      {tab === "markets" && <AdminMarkets markets={markets} />}
      {tab === "circles" && (
        <div className="space-y-6">
          <AdminCreateCircle />

          <section>
            <h2
              className="font-semibold text-sm mb-3"
              style={{ color: "var(--color-ink-primary)" }}
            >
              All circles ({circles.length})
            </h2>
            {circles.length === 0 ? (
              <p
                className="rounded-xl p-5 text-sm text-center"
                style={{
                  backgroundColor: "var(--color-bg-card)",
                  border: "1px solid var(--color-border)",
                  color: "var(--color-ink-tertiary)",
                }}
              >
                No circles yet. Create the first one above.
              </p>
            ) : (
              <ul className="space-y-2" data-testid="admin-circle-list">
                {circles.map((circle) => (
                  <li
                    key={circle.id}
                    className="flex items-center gap-3 rounded-xl p-3"
                    style={{
                      backgroundColor: "var(--color-bg-card)",
                      border: "1px solid var(--color-border)",
                    }}
                    data-testid="admin-circle-row"
                    data-circle-slug={circle.slug}
                  >
                    <div className="flex-1 min-w-0">
                      <Link
                        href={`/circles/${circle.slug}`}
                        className="text-sm font-medium truncate hover:underline"
                        style={{ color: "var(--color-ink-primary)" }}
                      >
                        {circle.name}
                      </Link>
                      <p
                        className="text-xs font-mono mt-0.5"
                        style={{ color: "var(--color-ink-tertiary)" }}
                      >
                        /circles/{circle.slug} · {circle.joining_policy}
                        {circle.invite_code ? ` · ${circle.invite_code}` : ""}
                      </p>
                    </div>
                    <span
                      className="text-xs flex-shrink-0"
                      style={{ color: "var(--color-ink-tertiary)" }}
                    >
                      {circle.member_count} / {circle.max_members}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
      {tab === "users" && <AdminUsers users={users} />}
      {tab === "incidents" && (
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
              Community Incident Reports
            </h2>
            <p
              className="text-xs mt-0.5"
              style={{ color: "var(--color-ink-tertiary)" }}
            >
              Passed reports auto-resolve after 24h. Veto to cancel or &quot;Resolve Now&quot; to apply immediately.
            </p>
          </div>
          <div className="p-4">
            <AdminIncidents reports={incidentReports} />
          </div>
        </div>
      )}
    </div>
  );
}
