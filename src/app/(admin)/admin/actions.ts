"use server";

import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { americanOddsToProb } from "@/lib/market-logic";
import type { MarketCategory } from "@/types/database";
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
export async function setMarketLine(marketId: string, yesOdds: number) {
  await requireAdmin();
  const admin = createAdminClient();

  const { data: market } = await admin
    .from("markets")
    .select("yes_pool, no_pool")
    .eq("id", marketId)
    .single();

  if (!market) throw new Error("Market not found");

  const total = market.yes_pool + market.no_pool;
  const p = americanOddsToProb(yesOdds);
  const newYesPool = Math.round(total * p);
  const newNoPool = total - newYesPool;

  const { error } = await admin
    .from("markets")
    .update({ yes_pool: newYesPool, no_pool: newNoPool })
    .eq("id", marketId);

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

  // Notify the suggester
  await admin.from("notifications").insert({
    user_id: s.user_id,
    type: "suggestion_approved",
    title: "Your suggestion was approved! 🎉",
    body: `"${s.title}" is now live as a market.`,
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
