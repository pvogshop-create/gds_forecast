"use server";

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// ─── Daily Bonus ──────────────────────────────────────────────────────────────
//
// There is deliberately no claimDailyBonus action here. One existed, was never
// imported by anything, and could not have worked if it had been: it used the
// user-scoped client, and the `prevent_coin_manipulation` trigger rejects any
// authenticated-role write to profiles.coins. The live path is
// `POST /api/daily-bonus`, which uses the service-role client for exactly that
// reason. Removed 2026-07-29 while building the E2E suite.

// ─── Incident Reports ─────────────────────────────────────────────────────────

export async function submitIncidentReport(
  marketId: string,
  description: string,
  proposedOutcome: string
): Promise<string> {
  const user = await requireAuth();
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("submit_incident_report", {
    p_market_id: marketId,
    p_reporter_id: user.id,
    p_description: description,
    p_proposed_outcome: proposedOutcome,
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/market/${marketId}`);
  revalidatePath("/more");
  return data as string;
}

export async function castIncidentVote(
  reportId: string,
  agrees: boolean
): Promise<void> {
  const user = await requireAuth();
  const supabase = await createClient();

  const { error } = await supabase.rpc("cast_incident_vote", {
    p_report_id: reportId,
    p_user_id: user.id,
    p_agrees: agrees,
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/more");
}
