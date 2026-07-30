import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/auth";
import { ActivityFeed } from "@/components/feed/ActivityFeed";
import { Leaderboard } from "@/components/feed/Leaderboard";
import { markAllNotificationsRead } from "./actions";
import { formatRelativeTime } from "@/lib/utils";
import type {
  ActivityFeedEntryWithProfile,
  Notification,
  Profile,
} from "@/types/database";

export default async function NotificationsPage() {
  const user = await requireAuth();
  const supabase = await createClient();

  const [notifResult, feedResult, leaderboardResult] = await Promise.all([
    supabase
      .from("notifications")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50),

    supabase
      .from("activity_feed")
      .select(
        `
        *,
        profiles:user_id (username, display_name, avatar_url),
        markets:market_id (title, category, yes_probability)
        `
      )
      .order("created_at", { ascending: false })
      .limit(50),

    supabase
      .from("profiles")
      .select("id, username, display_name, avatar_url, coins, wins, total_bets")
      .not("username", "is", null)
      .order("coins", { ascending: false })
      .limit(10),
  ]);

  const notifications = (notifResult.data ?? []) as Notification[];
  const feedEntries = (feedResult.data ?? []) as ActivityFeedEntryWithProfile[];
  const leaderboard = (leaderboardResult.data ?? []) as Pick<
    Profile,
    "id" | "username" | "display_name" | "avatar_url" | "coins" | "wins" | "total_bets"
  >[];

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return (
    <div>
      <h1
        className="text-xl font-bold mb-4"
        style={{ color: "var(--color-ink-primary)" }}
      >
        Notifications
      </h1>

      <div className="space-y-4">
        {/* Personal notifications */}
        <div
          className="rounded-xl overflow-hidden"
          style={{
            backgroundColor: "var(--color-bg-card)",
            border: "1px solid var(--color-border)",
            boxShadow: "var(--shadow-card)",
          }}
        >
          <div
            className="px-4 py-3 flex items-center justify-between"
            style={{ borderBottom: "1px solid var(--color-border)" }}
          >
            <div className="flex items-center gap-2">
              <h2
                className="font-semibold text-sm"
                style={{ color: "var(--color-ink-primary)" }}
              >
                Your Notifications
              </h2>
              {unreadCount > 0 && (
                <span
                  className="min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
                  style={{ backgroundColor: "var(--color-danger)" }}
                  data-testid="alerts-unread-badge"
                  data-unread={unreadCount}
                >
                  {unreadCount}
                </span>
              )}
            </div>
            {unreadCount > 0 && (
              <form action={markAllNotificationsRead}>
                <button
                  type="submit"
                  data-testid="mark-all-read"
                  className="text-xs transition-colors duration-150"
                  style={{ color: "var(--color-primary)" }}
                >
                  Mark all as read
                </button>
              </form>
            )}
          </div>

          {notifications.length === 0 ? (
            <div className="flex flex-col items-center py-10 text-center">
              <p className="text-2xl mb-2">🔔</p>
              <p
                className="text-sm"
                style={{ color: "var(--color-ink-secondary)" }}
              >
                No notifications yet.
              </p>
            </div>
          ) : (
            <ul>
              {notifications.map((notif, index) => (
                <li
                  key={notif.id}
                  data-testid="notification-item"
                  data-type={notif.type}
                  data-read={notif.is_read}
                  className="px-4 py-3 transition-colors duration-150"
                  style={{
                    backgroundColor: notif.is_read
                      ? undefined
                      : "var(--color-primary-light)",
                    borderBottom:
                      index < notifications.length - 1
                        ? "1px solid var(--color-border)"
                        : undefined,
                  }}
                >
                  <p
                    className="text-sm font-semibold"
                    style={{ color: "var(--color-ink-primary)" }}
                  >
                    {notif.title}
                  </p>
                  <p
                    className="text-xs mt-0.5"
                    style={{ color: "var(--color-ink-secondary)" }}
                  >
                    {notif.body}
                  </p>
                  <time
                    className="text-xs mt-1 block"
                    style={{ color: "var(--color-ink-tertiary)" }}
                    dateTime={notif.created_at}
                  >
                    {formatRelativeTime(notif.created_at)}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Leaderboard */}
        <Leaderboard users={leaderboard} />

        {/* Activity feed */}
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
              Recent Activity
            </h2>
          </div>
          <ActivityFeed entries={feedEntries} />
        </div>
      </div>
    </div>
  );
}
