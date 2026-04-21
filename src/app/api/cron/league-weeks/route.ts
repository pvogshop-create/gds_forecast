import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Called daily at midnight UTC via Vercel Cron (see vercel.json).
// 1. Closes any active weeks whose week_end has passed.
// 2. Starts a new week for any league whose current week is not active.

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const results: {
    closed: { week_id: string; result: unknown }[];
    started: { league_id: string; result: unknown }[];
    errors: { id: string; action: string; error: string }[];
  } = { closed: [], started: [], errors: [] };

  // ── 1. Close overdue active weeks ────────────────────────────────────────
  const { data: overdueWeeks, error: overdueErr } = await admin
    .from("league_weeks")
    .select("id")
    .eq("status", "active")
    .lt("week_end", new Date().toISOString());

  if (overdueErr) {
    return NextResponse.json(
      { error: "Failed to query overdue weeks", details: overdueErr.message },
      { status: 500 }
    );
  }

  for (const week of overdueWeeks ?? []) {
    const { data, error } = await admin.rpc("close_league_week", {
      p_week_id: week.id,
    });
    if (error) {
      results.errors.push({ id: week.id, action: "close", error: error.message });
    } else {
      results.closed.push({ week_id: week.id, result: data });
    }
  }

  // ── 2. Start new weeks for leagues that have no active week ───────────────
  const { data: eligibleLeagues, error: leaguesErr } = await admin
    .from("leagues")
    .select("id")
    .not("week_start_date", "is", null)
    .lte("week_start_date", new Date().toISOString());

  if (leaguesErr) {
    return NextResponse.json(
      { error: "Failed to query leagues", details: leaguesErr.message },
      { status: 500 }
    );
  }

  for (const league of eligibleLeagues ?? []) {
    // Only start if no week is currently active
    const { data: existing } = await admin
      .from("league_weeks")
      .select("id")
      .eq("league_id", league.id)
      .eq("status", "active")
      .maybeSingle();

    if (existing) continue;

    const { data, error } = await admin.rpc("start_league_week", {
      p_league_id: league.id,
    });
    if (error) {
      results.errors.push({ id: league.id, action: "start", error: error.message });
    } else {
      results.started.push({ league_id: league.id, result: data });
    }
  }

  return NextResponse.json({
    ok: true,
    closed: results.closed.length,
    started: results.started.length,
    errors: results.errors,
  });
}
