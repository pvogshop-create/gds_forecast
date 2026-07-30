import { type NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";

// Secured with CRON_SECRET env var (set in Vercel environment variables).
// Vercel Cron calls this endpoint daily (see vercel.json).
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  // CRON_SECRET is REQUIRED, not merely enforced-if-present. The previous
  // `if (cronSecret && ...)` form meant an unset secret left this endpoint
  // completely open — and it became publicly reachable once `/api/cron` was
  // added to PUBLIC_ROUTES in src/proxy.ts. Matches league-weeks/route.ts.
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
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
      const note = "Auto-resolved via community incident report";

      // Call the RPCs directly rather than via the admin Server Actions
      // (resolveMarket / resolveOuMarket). Those begin with requireAdmin(),
      // which for a session-less cron request calls redirect("/login") — and
      // that throws NEXT_REDIRECT, which the catch below swallowed as
      // `status: "error"`. Net effect: auto-resolution silently never worked.
      // resolve_market gates on auth.role() = 'service_role', which the admin
      // client satisfies, so this is the correct caller. p_admin_id is only
      // stored in markets.resolved_by (nullable, never validated) and there is
      // no admin user in a cron context, so it is passed as null.
      let rpcError: { message: string } | null;
      if (market.market_type === "over_under") {
        const resultValue = parseFloat(outcome);
        if (isNaN(resultValue)) throw new Error("Invalid O/U result value");
        ({ error: rpcError } = await admin.rpc("resolve_ou_market", {
          p_market_id: market.id,
          p_result_value: resultValue,
          p_admin_id: null,
          p_note: note,
        }));
      } else {
        if (outcome !== "yes" && outcome !== "no") throw new Error("Invalid binary outcome");
        ({ error: rpcError } = await admin.rpc("resolve_market", {
          p_market_id: market.id,
          p_outcome: outcome,
          p_admin_id: null,
          p_note: note,
        }));
      }
      if (rpcError) throw new Error(rpcError.message);

      revalidatePath(`/market/${market.id}`);
      revalidatePath("/dashboard/trending");

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
