"use server";

import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { americanOddsToProb } from "@/lib/market-logic";
import type { CircleJoiningPolicy, MarketCategory } from "@/types/database";
import type { MarketSuggestion } from "@/types/database";

// ─── Create Market ────────────────────────────────────────────────────────────
export async function createMarket(formData: FormData) {
  const user = await requireAdmin();
  const admin = createAdminClient();

  const title = (formData.get("title") as string | null)?.trim() ?? "";
  const description = (formData.get("description") as string | null)?.trim() ?? "";
  const category = formData.get("category") as MarketCategory;
  const resolutionDate = formData.get("resolution_date") as string | null;
  const isFeatured = formData.get("is_featured") === "true";
  const marketType = (formData.get("market_type") as string | null) ?? "binary";
  const initialOdds = parseInt((formData.get("initial_odds") as string | null) ?? "100", 10) || 100;
  const ouLineRaw = parseFloat((formData.get("ou_line") as string | null) ?? "");
  const ouLine = isNaN(ouLineRaw) ? null : ouLineRaw;
  const ouUnit = (formData.get("ou_unit") as string | null)?.trim() || null;

  if (!title || !description || !category) {
    throw new Error("Missing required fields: title, description, and category are required.");
  }

  let marketInsert: Record<string, unknown>;

  if (marketType === "over_under") {
    if (!ouLine || !ouUnit) {
      throw new Error("O/U markets require an opening line and unit.");
    }
    marketInsert = {
      title,
      description,
      category,
      resolution_date: resolutionDate || null,
      is_featured: isFeatured,
      creator_id: user.id,
      market_type: "over_under",
      ou_line: ouLine,
      ou_opening_line: ouLine,
      ou_unit: ouUnit,
      yes_pool: 0,
      no_pool: 0,
    };
  } else {
    const p = americanOddsToProb(initialOdds);
    const yesPool = Math.round(200 * p);
    marketInsert = {
      title,
      description,
      category,
      resolution_date: resolutionDate || null,
      is_featured: isFeatured,
      creator_id: user.id,
      yes_pool: yesPool,
      no_pool: 200 - yesPool,
    };
  }

  const { error } = await admin.from("markets").insert(marketInsert);

  if (error) throw new Error(`Failed to create market: ${error.message}`);
  revalidatePath("/admin");
  revalidatePath("/dashboard/trending");
}

// ─── Create Circle ────────────────────────────────────────────────────────────
/**
 * Circle creation is admin-only (0029): `circles_insert` is service_role, so
 * this is the only path that exists.
 *
 * It calls the `create_circle` RPC rather than inserting directly, because the
 * circle row and the creator's membership row must land in one transaction —
 * a circle with no creator membership is invisible to everyone including its
 * own creator, since `circles_select` is membership-based. Splitting it into
 * two client writes is the same read-modify-write shape 0027 removed from
 * `setMarketLine()`.
 */
export async function createCircle(formData: FormData) {
  const user = await requireAdmin();
  const admin = createAdminClient();

  const name = (formData.get("name") as string | null)?.trim() ?? "";
  const rawSlug = (formData.get("slug") as string | null)?.trim() ?? "";
  const description = (formData.get("description") as string | null)?.trim() ?? "";
  const joiningPolicy =
    (formData.get("joining_policy") as CircleJoiningPolicy | null) ?? "invite_code";

  if (!name) throw new Error("Circle name is required.");

  const slug = slugify(rawSlug || name);
  if (!/^[a-z0-9-]{3,40}$/.test(slug)) {
    throw new Error(
      "Slug must be 3–40 characters of lowercase letters, numbers or hyphens."
    );
  }

  const { error } = await admin.rpc("create_circle", {
    p_name: name,
    p_slug: slug,
    p_creator_id: user.id,
    p_description: description || null,
    p_joining_policy: joiningPolicy,
  });

  if (error) {
    // 23505 is the UNIQUE violation on slug — by far the most likely failure,
    // and the generic message would send the admin hunting for the wrong thing.
    if (error.code === "23505") {
      throw new Error(`The slug "${slug}" is already taken. Choose another.`);
    }
    // The function does not exist in this database. PostgREST reports a missing
    // RPC as PGRST202 (not in the schema cache) and Postgres as 42883.
    //
    // In practice this means one thing: the environment you are pointed at has
    // not had 0029 applied. Saying so is the whole point — a generic "failed to
    // create circle" sends you looking at the form, and a production build
    // redacts the underlying message entirely, so the admin sees only an opaque
    // digest error and has nothing to go on.
    if (error.code === "PGRST202" || error.code === "42883") {
      throw new Error(
        "This database does not have the circles migration (0029) applied. " +
          "Check which Supabase project the app is pointed at — `npx supabase " +
          "migration list --linked` shows what the remote actually has."
      );
    }
    throw new Error(`Failed to create circle: ${error.message} (${error.code})`);
  }

  revalidatePath("/admin");
  revalidatePath("/circles");
}

/** Mirrors the ^[a-z0-9-]{3,40}$ CHECK on `circles.slug`. */
function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
}

// ─── Resolve Market ───────────────────────────────────────────────────────────
export async function resolveMarket(
  marketId: string,
  outcome: "yes" | "no",
  note?: string
) {
  const user = await requireAdmin();
  const admin = createAdminClient();

  const { error } = await admin.rpc("resolve_market", {
    p_market_id: marketId,
    p_outcome: outcome,
    p_admin_id: user.id,
    p_note: note ?? null,
  });

  if (error) throw new Error(`Failed to resolve market: ${error.message}`);
  revalidatePath("/admin");
  revalidatePath(`/market/${marketId}`);
  revalidatePath("/dashboard/trending");
}

// ─── Close/Reopen Market ──────────────────────────────────────────────────────
export async function setMarketStatus(
  marketId: string,
  status: "open" | "closed"
) {
  await requireAdmin();
  const admin = createAdminClient();

  const { error } = await admin
    .from("markets")
    .update({ status })
    .eq("id", marketId);

  if (error) throw new Error(`Failed to update market status: ${error.message}`);
  revalidatePath("/admin");
}

// ─── Set Market Line ──────────────────────────────────────────────────────────
// Adjusts yes_pool/no_pool to reflect the given American odds for YES,
// keeping total pool size constant.
//
// The arithmetic lives in the `set_market_line` RPC (0026), not here. It used to
// run in this function as SELECT pools → compute → UPDATE pools, which is two
// PostgREST round trips in two separate transactions with no row lock. Every
// other writer of these columns (`place_bet`, `place_ou_bet`) takes
// `SELECT ... FOR UPDATE` on the market first, so a bet landing between this
// function's read and its write had its pool contribution silently overwritten —
// the bettor stayed debited, their position kept its locked odds, and the coins
// simply left the pool. Doing it in one locked statement server-side is what
// closes that window.
export async function setMarketLine(marketId: string, yesOdds: number) {
  await requireAdmin();
  const admin = createAdminClient();

  const { error } = await admin.rpc("set_market_line", {
    p_market_id: marketId,
    p_yes_odds: yesOdds,
  });

  if (error) throw new Error(`Failed to set market line: ${error.message}`);
  revalidatePath("/admin");
  revalidatePath(`/market/${marketId}`);
}

// ─── Approve Suggestion ───────────────────────────────────────────────────────
// yesOdds: American odds for YES side (e.g. +150, -110). Defaults to +100 (even).
// For O/U suggestions, yesOdds is ignored — odds are always +100.
// ouLineOverride: optional admin-edited opening line for O/U markets.
export async function approveSuggestion(
  suggestionId: string,
  yesOdds: number = 100,
  ouLineOverride?: number
) {
  const user = await requireAdmin();
  const admin = createAdminClient();

  // Fetch the suggestion
  const { data: suggestion, error: fetchError } = await admin
    .from("market_suggestions")
    .select("*")
    .eq("id", suggestionId)
    .single();

  if (fetchError || !suggestion) throw new Error("Suggestion not found");

  const s = suggestion as MarketSuggestion;
  const isOu = s.market_type === "over_under";

  let marketInsert: Record<string, unknown>;

  if (isOu) {
    // Admin may override the opening line; fall back to the suggester's value
    const ouLine = ouLineOverride ?? s.ou_opening_line;
    // O/U markets start with 0/0 pools (no CPMM liquidity needed)
    marketInsert = {
      title: s.title,
      description: s.description,
      category: s.category,
      creator_id: user.id,
      suggested_by: s.user_id,
      market_type: "over_under",
      ou_line: ouLine,
      ou_opening_line: ouLine,
      ou_unit: s.ou_unit,
      yes_pool: 0,
      no_pool: 0,
    };
  } else {
    // Binary: convert American odds to initial pool ratio (total starting pool = 200)
    const p = americanOddsToProb(yesOdds);
    const yesPool = Math.round(200 * p);
    const noPool = 200 - yesPool;
    marketInsert = {
      title: s.title,
      description: s.description,
      category: s.category,
      creator_id: user.id,
      suggested_by: s.user_id,
      yes_pool: yesPool,
      no_pool: noPool,
    };
  }

  // Create market from suggestion
  const { data: market, error: createError } = await admin
    .from("markets")
    .insert(marketInsert)
    .select("id")
    .single();

  if (createError || !market) throw new Error("Failed to create market from suggestion");

  // Update suggestion status
  await admin
    .from("market_suggestions")
    .update({ status: "approved" })
    .eq("id", suggestionId);

  // Award 100 coins to the suggester
  await admin.rpc("admin_adjust_balance", {
    p_user_id: s.user_id,
    p_amount: 100,
  });

  // Notify the suggester (includes coin reward in message)
  await admin.from("notifications").insert({
    user_id: s.user_id,
    type: "suggestion_approved",
    title: "Your suggestion was approved! 🎉",
    body: `"${s.title}" is now live as a market. You earned 100 coins for the suggestion!`,
    data: { market_id: market.id, suggestion_id: suggestionId },
  });

  revalidatePath("/admin");
}

// ─── Resolve O/U Market ───────────────────────────────────────────────────────
// Admin provides the actual numeric result.
// Each position is resolved individually against its locked ou_line_at_bet.
export async function resolveOuMarket(
  marketId: string,
  resultValue: number,
  note?: string
) {
  const user = await requireAdmin();
  const admin = createAdminClient();

  const { error } = await admin.rpc("resolve_ou_market", {
    p_market_id: marketId,
    p_result_value: resultValue,
    p_admin_id: user.id,
    p_note: note ?? null,
  });

  if (error) throw new Error(`Failed to resolve O/U market: ${error.message}`);
  revalidatePath("/admin");
  revalidatePath(`/market/${marketId}`);
  revalidatePath("/dashboard/trending");
}

// ─── Reject Suggestion ────────────────────────────────────────────────────────
export async function rejectSuggestion(suggestionId: string, note?: string) {
  await requireAdmin();
  const admin = createAdminClient();

  const { data: suggestion } = await admin
    .from("market_suggestions")
    .select("user_id, title")
    .eq("id", suggestionId)
    .single();

  await admin
    .from("market_suggestions")
    .update({ status: "rejected", admin_note: note ?? null })
    .eq("id", suggestionId);

  if (suggestion) {
    await admin.from("notifications").insert({
      user_id: suggestion.user_id,
      type: "suggestion_rejected",
      title: "Suggestion not approved",
      body: `"${suggestion.title}" was not approved.${note ? ` Note: ${note}` : ""}`,
      data: { suggestion_id: suggestionId },
    });
  }

  revalidatePath("/admin");
}

// ─── Adjust User Balance ──────────────────────────────────────────────────────
export async function adjustUserBalance(
  userId: string,
  amount: number,
  reason: string
) {
  await requireAdmin();
  const admin = createAdminClient();

  // Atomic increment via SQL function — avoids TOCTOU race between read and write
  const { error: updateError } = await admin.rpc("admin_adjust_balance", {
    p_user_id: userId,
    p_amount: amount,
  });

  if (updateError)
    throw new Error(`Failed to adjust balance: ${updateError.message}`);

  // Notify the user
  await admin.from("notifications").insert({
    user_id: userId,
    type: "payout_received",
    title: amount > 0 ? "Coins added to your balance" : "Coins deducted",
    body: `${Math.abs(amount)} coins ${amount > 0 ? "added" : "deducted"}. Reason: ${reason}`,
    data: { amount, reason },
  });

  revalidatePath("/admin");
}

// ─── Incident Report: Veto ────────────────────────────────────────────────────
export async function vetoIncident(reportId: string) {
  await requireAdmin();
  const admin = createAdminClient();

  const { error } = await admin
    .from("incident_reports")
    .update({ status: "vetoed", updated_at: new Date().toISOString() })
    .eq("id", reportId)
    .in("status", ["voting", "passed"]);

  if (error) throw new Error(`Failed to veto incident: ${error.message}`);

  revalidatePath("/admin");
}

// ─── Incident Report: Resolve from incident ───────────────────────────────────
export async function resolveFromIncident(reportId: string) {
  await requireAdmin();
  const admin = createAdminClient();

  // Fetch the incident report with market info
  const { data: report, error: fetchError } = await admin
    .from("incident_reports")
    .select("*, markets (id, market_type, status)")
    .eq("id", reportId)
    .single();

  if (fetchError || !report) {
    throw new Error("Incident report not found.");
  }

  const market = (report as { markets: { id: string; market_type: string; status: string } }).markets;

  if (!market || !["open", "closed"].includes(market.status)) {
    throw new Error("Market cannot be resolved from this state.");
  }

  const outcome = report.proposed_outcome as string;

  if (market.market_type === "over_under") {
    const resultValue = parseFloat(outcome);
    if (isNaN(resultValue)) {
      throw new Error("Invalid O/U result value in incident report.");
    }
    await resolveOuMarket(market.id, resultValue, `Community incident report #${reportId}`);
  } else {
    if (outcome !== "yes" && outcome !== "no") {
      throw new Error("Invalid binary outcome in incident report.");
    }
    await resolveMarket(market.id, outcome as "yes" | "no", `Community incident report #${reportId}`);
  }

  // Mark incident as resolved
  await admin
    .from("incident_reports")
    .update({ status: "resolved", updated_at: new Date().toISOString() })
    .eq("id", reportId);

  revalidatePath("/admin");
}
