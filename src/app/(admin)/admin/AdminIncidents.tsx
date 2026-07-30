"use client";

import { useTransition } from "react";
import { vetoIncident, resolveFromIncident } from "./actions";
import type { IncidentReportWithMarket } from "@/types/database";

interface AdminIncidentsProps {
  reports: IncidentReportWithMarket[];
}

export function AdminIncidents({ reports }: AdminIncidentsProps) {
  const passed = reports.filter((r) => r.status === "passed");
  const voting = reports.filter((r) => r.status === "voting");

  if (reports.length === 0) {
    return (
      <p
        className="text-sm text-center py-6"
        style={{ color: "var(--color-ink-tertiary)" }}
      >
        No active incident reports.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {passed.length > 0 && (
        <div>
          <h3
            className="text-xs font-semibold uppercase tracking-wide mb-3"
            style={{ color: "var(--color-ink-tertiary)" }}
          >
            Pending Resolution ({passed.length})
          </h3>
          <div className="space-y-3">
            {passed.map((report) => (
              <IncidentRow key={report.id} report={report} showActions />
            ))}
          </div>
        </div>
      )}

      {voting.length > 0 && (
        <div>
          <h3
            className="text-xs font-semibold uppercase tracking-wide mb-3"
            style={{ color: "var(--color-ink-tertiary)" }}
          >
            Currently Voting ({voting.length})
          </h3>
          <div className="space-y-3">
            {voting.map((report) => (
              <IncidentRow key={report.id} report={report} showActions={false} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function IncidentRow({
  report,
  showActions,
}: {
  report: IncidentReportWithMarket;
  showActions: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const total = report.yes_votes + report.no_votes;
  const agreeRate = total > 0 ? Math.round((report.yes_votes / total) * 100) : 0;

  let vetoDeadlineText = "";
  if (report.veto_deadline) {
    const ms = new Date(report.veto_deadline).getTime() - Date.now();
    if (ms > 0) {
      const h = Math.floor(ms / (1000 * 60 * 60));
      const m = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
      vetoDeadlineText = `Auto-resolves in ${h}h ${m}m`;
    } else {
      vetoDeadlineText = "Past veto deadline — awaiting cron";
    }
  }

  return (
    <div
      data-testid="admin-incident-row"
      data-report-id={report.id}
      data-status={report.status}
      className="rounded-lg p-4"
      style={{
        backgroundColor: "var(--color-bg)",
        border: `1px solid ${report.status === "passed" ? "var(--color-yes)" : "var(--color-border)"}`,
      }}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex-1 min-w-0">
          <p
            className="text-sm font-medium"
            style={{ color: "var(--color-ink-primary)" }}
          >
            {report.markets.title}
          </p>
          <p
            className="text-xs mt-0.5 line-clamp-2"
            style={{ color: "var(--color-ink-secondary)" }}
          >
            {report.description}
          </p>
        </div>
        <span
          className="flex-shrink-0 px-2 py-0.5 rounded text-xs font-mono font-bold"
          style={{
            backgroundColor:
              report.status === "passed"
                ? "var(--color-yes-bg)"
                : "var(--color-primary-light)",
            color:
              report.status === "passed"
                ? "var(--color-yes)"
                : "var(--color-primary)",
          }}
        >
          {report.proposed_outcome.toUpperCase()}
        </span>
      </div>

      <p
        className="text-xs mb-1"
        style={{ color: "var(--color-ink-tertiary)" }}
      >
        {total === 0
          ? "No votes yet"
          : `${report.yes_votes} agree · ${report.no_votes} disagree · ${agreeRate}%`}
        {vetoDeadlineText && ` · ${vetoDeadlineText}`}
      </p>

      {showActions && (
        <div className="flex gap-2 mt-3">
          <form
            action={async () => {
              startTransition(async () => {
                await resolveFromIncident(report.id);
              });
            }}
          >
            <button
              type="submit"
              data-testid="admin-resolve-now"
              disabled={isPending}
              className="px-3 py-1.5 rounded text-xs font-semibold text-white transition-all duration-150"
              style={{
                backgroundColor: "var(--color-yes)",
                opacity: isPending ? 0.6 : 1,
              }}
            >
              Resolve Now
            </button>
          </form>
          <form
            action={async () => {
              startTransition(async () => {
                await vetoIncident(report.id);
              });
            }}
          >
            <button
              type="submit"
              data-testid="admin-veto"
              disabled={isPending}
              className="px-3 py-1.5 rounded text-xs font-semibold transition-all duration-150"
              style={{
                backgroundColor: "var(--color-no-bg)",
                color: "var(--color-no)",
                border: "1px solid var(--color-no)",
                opacity: isPending ? 0.6 : 1,
              }}
            >
              Veto
            </button>
          </form>
        </div>
      )}

      {!showActions && (
        <form
          action={async () => {
            startTransition(async () => {
              await vetoIncident(report.id);
            });
          }}
          className="mt-3"
        >
          <button
            type="submit"
            disabled={isPending}
            className="px-3 py-1.5 rounded text-xs font-semibold transition-all duration-150"
            style={{
              backgroundColor: "var(--color-bg-card)",
              color: "var(--color-ink-tertiary)",
              border: "1px solid var(--color-border)",
              opacity: isPending ? 0.6 : 1,
            }}
          >
            Dismiss
          </button>
        </form>
      )}
    </div>
  );
}
