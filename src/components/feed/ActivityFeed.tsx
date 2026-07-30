import { ActivityFeedItem } from "./ActivityFeedItem";
import type { ActivityFeedEntryWithProfile } from "@/types/database";

interface ActivityFeedProps {
  entries: ActivityFeedEntryWithProfile[];
}

export function ActivityFeed({ entries }: ActivityFeedProps) {
  if (entries.length === 0) {
    return (
      <div
        className="flex flex-col items-center py-12 px-4 text-center"
        data-testid="activity-feed-empty"
      >
        <div className="text-3xl mb-2">📭</div>
        <p
          className="text-sm font-medium"
          style={{ color: "var(--color-ink-secondary)" }}
        >
          No activity yet.
        </p>
        <p
          className="text-xs mt-1"
          style={{ color: "var(--color-ink-tertiary)" }}
        >
          Be the first to place a bet!
        </p>
      </div>
    );
  }

  return (
    <ul
      className="divide-y"
      style={{ borderColor: "var(--color-border)" }}
      data-testid="activity-feed"
      data-count={entries.length}
    >
      {entries.map((entry) => (
        <li key={entry.id} data-testid="activity-feed-item">
          <ActivityFeedItem entry={entry} />
        </li>
      ))}
    </ul>
  );
}
