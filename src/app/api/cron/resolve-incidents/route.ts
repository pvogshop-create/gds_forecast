import { type NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveMarket, resolveOuMarket } from "@/app/(admin)/admin/actions";

// Secured with CRON_SECRET env var (set in Vercel environment variables).
// Vercel Cron calls this endpoint hourly.
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  // If CRON_SECRET is set, enforce it
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Find all passed reports whose veto deadline has expired
  const { data: dueReports, error } = await admin
    .from("incident_reports")
    .select("*, markets (id, market_type, status)")
    .eq("status", "passed")
    .lte("veto_deadline", new Date().toISOString());

  if (error) {
    console.error("[cron/resolve-incidents] Failed to fetch due reports:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const reports = dueReports ?? [];
  const results: { reportId: string; status: string; error?: string }[] = [];

  for (const report of reports) {
    const market = (report as {
      markets: { id: string; market_type: string; status: string } | null;
    }).markets;

    if (!market || !["open", "closed"].includes(market.status)) {
      // Skip — market not resolvable
      await admin
        .from("incident_reports")
        .update({ status: "dismissed", updated_at: new Date().toISOString() })
        .eq("id", report.id);
      results.push({ reportId: report.id, status: "dismissed — market not resolvable" });
      continue;
    }

    try {
      const outcome = report.proposed_outcome as string;

      if (market.market_type === "over_under") {
        const resultValue = parseFloat(outcome);
        if (isNaN(resultValue)) throw new Error("Invalid O/U result value");
        await resolveOuMarket(
          market.id,
          resultValue,
          `Auto-resolved via community incident report`
        );
      } else {
        if (outcome !== "yes" && outcome !== "no") throw new Error("Invalid binary outcome");
        await resolveMarket(
          market.id,
          outcome as "yes" | "no",
          `Auto-resolved via community incident report`
        );
      }

      await admin
        .from("incident_reports")
        .update({ status: "resolved", updated_at: new Date().toISOString() })
        .eq("id", report.id);

      results.push({ reportId: report.id, status: "resolved" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[cron/resolve-incidents] Failed to resolve report ${report.id}:`, msg);
      results.push({ reportId: report.id, status: "error", error: msg });
    }
  }

  return NextResponse.json({
    processed: results.length,
    results,
    timestamp: new Date().toISOString(),
  });
}
