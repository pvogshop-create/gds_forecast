"use client";

import { useState } from "react";
import { Bell } from "lucide-react";
import { useNotifications } from "@/features/notifications/useNotifications";
import { Modal } from "@/components/ui/Modal";
import { formatRelativeTime } from "@/lib/utils";

interface NotificationBellProps {
  userId: string;
}

export function NotificationBell({ userId }: NotificationBellProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { notifications, unreadCount, markAllRead } =
    useNotifications(userId);

  function handleOpen() {
    setIsOpen(true);
    if (unreadCount > 0) void markAllRead();
  }

  return (
    <>
      <button
        onClick={handleOpen}
        className="relative w-9 h-9 rounded-xl flex items-center justify-center transition-colors duration-150 hover:bg-[var(--color-bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
      >
        <Bell
          size={18}
          strokeWidth={2}
          style={{ color: "var(--color-ink-secondary)" }}
        />
        {unreadCount > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
            style={{ backgroundColor: "var(--color-danger)" }}
            aria-hidden="true"
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      <Modal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title="Notifications"
        size="md"
      >
        {notifications.length === 0 ? (
          <div className="flex flex-col items-center py-8 text-center">
            <div className="text-3xl mb-2">🔔</div>
            <p
              className="text-sm"
              style={{ color: "var(--color-ink-secondary)" }}
            >
              No notifications yet.
            </p>
          </div>
        ) : (
          <ul
            className="divide-y max-h-96 overflow-y-auto -mx-6"
            style={{ borderColor: "var(--color-border)" }}
          >
            {notifications.map((notif) => (
              <li
                key={notif.id}
                className="px-6 py-3 transition-colors duration-150"
                style={{
                  backgroundColor: notif.is_read
                    ? undefined
                    : "var(--color-primary-light)",
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
                  className="text-xs"
                  style={{ color: "var(--color-ink-tertiary)" }}
                  dateTime={notif.created_at}
                >
                  {formatRelativeTime(notif.created_at)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </>
  );
}
