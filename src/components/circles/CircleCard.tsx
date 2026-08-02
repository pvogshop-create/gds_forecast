import Link from "next/link";
import { Globe, Lock, Users } from "lucide-react";
import type { Circle, CircleRole } from "@/types/database";

interface CircleCardProps {
  circle: Circle;
  /** The viewer's role, when they are a member. Absent for a discoverable
   *  circle they have not joined. */
  role?: CircleRole;
}

const ROLE_LABEL: Record<CircleRole, string> = {
  creator: "Creator",
  moderator: "Moderator",
  member: "Member",
};

export function CircleCard({ circle, role }: CircleCardProps) {
  const isOpen = circle.joining_policy === "open";

  return (
    <Link
      href={`/circles/${circle.slug}`}
      className="block group"
      data-testid="circle-card"
      data-circle-slug={circle.slug}
      data-member-count={circle.member_count}
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
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-white font-bold text-sm"
            style={{ backgroundColor: "var(--color-primary)" }}
          >
            {circle.name.slice(0, 2).toUpperCase()}
          </div>

          <div className="flex-1 min-w-0">
            <h3
              className="font-semibold text-sm truncate group-hover:underline"
              style={{
                color: "var(--color-ink-primary)",
                textDecorationColor: "var(--color-primary)",
              }}
            >
              {circle.name}
            </h3>
            {circle.description && (
              <p
                className="text-xs truncate mt-0.5"
                style={{ color: "var(--color-ink-tertiary)" }}
              >
                {circle.description}
              </p>
            )}
          </div>

          {role && role !== "member" && (
            <span
              className="text-xs font-bold px-2 py-1 rounded-lg flex-shrink-0"
              style={{
                backgroundColor: "var(--color-primary-light)",
                color: "var(--color-primary)",
              }}
              data-testid="circle-role-badge"
            >
              {ROLE_LABEL[role]}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 mt-3">
          <span className="flex items-center gap-1">
            <Users size={12} style={{ color: "var(--color-ink-tertiary)" }} strokeWidth={2} />
            <span className="text-xs" style={{ color: "var(--color-ink-tertiary)" }}>
              {circle.member_count} / {circle.max_members} members
            </span>
          </span>

          <span className="flex items-center gap-1">
            {isOpen ? (
              <Globe size={12} style={{ color: "var(--color-ink-tertiary)" }} strokeWidth={2} />
            ) : (
              <Lock size={12} style={{ color: "var(--color-ink-tertiary)" }} strokeWidth={2} />
            )}
            <span className="text-xs" style={{ color: "var(--color-ink-tertiary)" }}>
              {isOpen ? "Open to join" : "Invite only"}
            </span>
          </span>
        </div>
      </div>
    </Link>
  );
}
