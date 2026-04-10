"use server";

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// ─── Daily Bonus ──────────────────────────────────────────────────────────────

export async function claimDailyBonus(): Promise<{ award: number; coins_after: number }> {
  const user = await requireAuth();
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("claim_daily_bonus", {
    p_user_id: user.id,
  });

  if (error) {
    throw new Error(error.message);
  }

  // Do NOT call revalidatePath here — it triggers a full layout re-render
  // (including requireOnboarding) in the server-action response context, which
  // can crash. The EarnCoinsCard shows the award locally; the coin balance in
  // the sidebar refreshes on the next navigation.
  return data as { award: number; coins_after: number };
}

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
