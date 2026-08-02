import { notFound } from "next/navigation";
import Link from "next/link";
import { Globe, Lock, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/auth";
import { Avatar } from "@/components/ui/Avatar";
import { CopyInviteCode } from "@/components/ui/CopyInviteCode";
import { formatDisplayName } from "@/lib/utils";
import { LeaveCircleButton } from "./LeaveCircleButton";
import type { Circle, CircleMemberWithProfile, CircleRole } from "@/types/database";

interface CirclePageProps {
  params: Promise<{ slug: string }>;
}

const ROLE_LABEL: Record<CircleRole, string> = {
  creator: "Creator",
  moderator: "Moderator",
  member: "Member",
};

/** Creator first, then moderators, then members — each group alphabetical. */
const ROLE_ORDER: Record<CircleRole, number> = { creator: 0, moderator: 1, member: 2 };

export default async function CirclePage({ params }: CirclePageProps) {
  const user = await requireAuth();
  const { slug } = await params;
  const supabase = await createClient();

  const { data: circleRow, error } = await supabase
    .from("circles")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();

  // A query ERROR is not a 404. Letting it fall through to notFound() would
  // render a missing table or a recursive policy as "this circle doesn't
  // exist" — the failure would look like ordinary, correct access control and
  // nobody would ever investigate it.
  if (error) {
    throw new Error(
      `Could not load circle "${slug}": ${error.message} (${error.code}). ` +
        `This is a failed query, not a denied one — RLS denies by returning no rows.`
    );
  }

  // No row, no error: this is the real denial path. notFound() rather than a
  // "you don't have access" page, because distinguishing private from
  // nonexistent would confirm the circle exists to someone not allowed to know.
  if (!circleRow) notFound();
  const circle = circleRow as Circle;

  const { data: memberRows, error: memberError } = await supabase
    .from("circle_members")
    .select("*, profiles:user_id (username, display_name, avatar_url)")
    .eq("circle_id", circle.id);

  if (memberError) {
    throw new Error(
      `Could not load the roster for "${slug}": ${memberError.message} (${memberError.code}).`
    );
  }

  const members = (memberRows ?? []) as CircleMemberWithProfile[];
  const me = members.find((m) => m.user_id === user.id);
  const isModerator = me?.role === "creator" || me?.role === "moderator";

  const nameOf = (m: CircleMemberWithProfile) =>
    formatDisplayName(m.profiles.display_name, m.profiles.username);

  const sorted = [...members].sort((a, b) => {
    const byRole = ROLE_ORDER[a.role] - ROLE_ORDER[b.role];
    if (byRole !== 0) return byRole;
    return nameOf(a).localeCompare(nameOf(b));
  });

  return (
    <div data-testid="circle-detail" data-circle-slug={circle.slug}>
      <Link
        href="/circles"
        className="text-xs mb-3 inline-block hover:underline"
        style={{ color: "var(--color-ink-tertiary)" }}
      >
        ← All circles
      </Link>

      <header
        className="rounded-xl p-4 mb-4"
        style={{
          backgroundColor: "var(--color-bg-card)",
          border: "1px solid var(--color-border)",
        }}
      >
        <div className="flex items-start gap-3">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 text-white font-bold"
            style={{ backgroundColor: "var(--color-primary)" }}
          >
            {circle.name.slice(0, 2).toUpperCase()}
          </div>

          <div className="flex-1 min-w-0">
            <h1
              className="text-lg font-bold truncate"
              style={{ color: "var(--color-ink-primary)" }}
            >
              {circle.name}
            </h1>
            {circle.description && (
              <p className="text-sm mt-0.5" style={{ color: "var(--color-ink-secondary)" }}>
                {circle.description}
              </p>
            )}

            <div className="flex items-center gap-3 mt-2">
              <span className="flex items-center gap-1">
                <Users size={12} style={{ color: "var(--color-ink-tertiary)" }} strokeWidth={2} />
                <span className="text-xs" style={{ color: "var(--color-ink-tertiary)" }}>
                  {circle.member_count} / {circle.max_members} members
                </span>
              </span>
              <span className="flex items-center gap-1">
                {circle.joining_policy === "open" ? (
                  <Globe size={12} style={{ color: "var(--color-ink-tertiary)" }} strokeWidth={2} />
                ) : (
                  <Lock size={12} style={{ color: "var(--color-ink-tertiary)" }} strokeWidth={2} />
                )}
                <span className="text-xs" style={{ color: "var(--color-ink-tertiary)" }}>
                  {circle.joining_policy === "open" ? "Open to join" : "Invite only"}
                </span>
              </span>
            </div>
          </div>
        </div>

        {/* The invite code is a capability: anyone holding it can join, since
            find_circle_by_invite_code() treats knowing the code as the
            authorization. So it is shown to moderators only, not to every
            member. */}
        {isModerator && circle.invite_code && (
          <div
            className="flex items-center justify-between mt-4 pt-3"
            style={{ borderTop: "1px solid var(--color-border)" }}
            data-testid="circle-invite-row"
          >
            <div>
              <p className="text-xs font-medium" style={{ color: "var(--color-ink-secondary)" }}>
                Invite code
              </p>
              <p
                className="text-sm font-mono tracking-widest mt-0.5"
                style={{ color: "var(--color-ink-primary)" }}
                data-testid="circle-invite-code"
              >
                {circle.invite_code}
              </p>
            </div>
            <CopyInviteCode code={circle.invite_code} />
          </div>
        )}
      </header>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold" style={{ color: "var(--color-ink-secondary)" }}>
            Members
          </h2>
          {/* The creator cannot leave — circle_members_delete protects that row,
              so showing the button would be a guaranteed no-op. */}
          {me && me.role !== "creator" && (
            <LeaveCircleButton circleId={circle.id} circleName={circle.name} />
          )}
        </div>

        <ul className="space-y-2" data-testid="circle-members">
          {sorted.map((member) => (
            <li
              key={member.user_id}
              className="flex items-center gap-3 rounded-xl p-3"
              style={{
                backgroundColor: "var(--color-bg-card)",
                border: "1px solid var(--color-border)",
              }}
              data-testid="circle-member"
              data-username={member.profiles.username ?? ""}
            >
              <Avatar
                src={member.profiles.avatar_url}
                displayName={member.profiles.display_name}
                username={member.profiles.username}
                size="sm"
              />
              <div className="flex-1 min-w-0">
                <Link
                  href={`/profile/${member.profiles.username ?? ""}`}
                  className="text-sm font-medium truncate hover:underline"
                  style={{ color: "var(--color-ink-primary)" }}
                >
                  {nameOf(member)}
                </Link>
              </div>
              {member.role !== "member" && (
                <span
                  className="text-xs font-bold px-2 py-1 rounded-lg flex-shrink-0"
                  style={{
                    backgroundColor: "var(--color-primary-light)",
                    color: "var(--color-primary)",
                  }}
                >
                  {ROLE_LABEL[member.role]}
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* Circle-scoped markets do not exist yet: markets.circle_id arrives in
          0030 and tier-aware visibility in 0031. Saying so beats an empty pane
          that reads as a bug. */}
      <section
        className="rounded-xl p-6 mt-4 text-center"
        style={{
          backgroundColor: "var(--color-bg-card)",
          border: "1px dashed var(--color-border)",
        }}
        data-testid="circle-markets-placeholder"
      >
        <p className="text-sm font-medium" style={{ color: "var(--color-ink-primary)" }}>
          Circle markets are coming next.
        </p>
        <p className="text-xs mt-1" style={{ color: "var(--color-ink-tertiary)" }}>
          Soon you&apos;ll be able to suggest lines only this circle can see.
        </p>
      </section>
    </div>
  );
}
