import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/auth";
import { SuggestForm } from "./SuggestForm";
import { StatusBadge } from "@/components/ui/Badge";
import { formatRelativeTime } from "@/lib/utils";
import type { MarketSuggestion } from "@/types/database";

export default async function SuggestPage() {
  const user = await requireAuth();
  const supabase = await createClient();

  const { data } = await supabase
    .from("market_suggestions")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(20);

  const suggestions = (data ?? []) as MarketSuggestion[];

  return (
    <div className="space-y-6">
      <div>
        <h1
          className="text-xl font-bold"
          style={{ color: "var(--color-ink-primary)" }}
        >
          Suggest a Market
        </h1>
        <p
          className="text-sm mt-1"
          style={{ color: "var(--color-ink-secondary)" }}
        >
          Have a prediction idea? Submit it and an admin will review it.
        </p>
      </div>

      {/* Suggestion form */}
      <SuggestForm userId={user.id} />

      {/* Past suggestions */}
      {suggestions.length > 0 && (
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
              Your Suggestions
            </h2>
          </div>
          <ul>
            {suggestions.map((s, index) => (
              <li
                key={s.id}
                className="px-4 py-3"
                style={{
                  borderBottom:
                    index < suggestions.length - 1
                      ? "1px solid var(--color-border)"
                      : undefined,
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p
                      className="text-sm font-medium"
                      style={{ color: "var(--color-ink-primary)" }}
                    >
                      {s.title}
                    </p>
                    <p
                      className="text-xs mt-0.5 line-clamp-2"
                      style={{ color: "var(--color-ink-tertiary)" }}
                    >
                      {s.description}
                    </p>
                    {s.admin_note && (
                      <p
                        className="text-xs mt-1 italic"
                        style={{ color: "var(--color-ink-secondary)" }}
                      >
                        Admin note: {s.admin_note}
                      </p>
                    )}
                    <time
                      className="text-xs"
                      style={{ color: "var(--color-ink-tertiary)" }}
                    >
                      {formatRelativeTime(s.created_at)}
                    </time>
                  </div>
                  <StatusBadge status={s.status} className="flex-shrink-0" />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
