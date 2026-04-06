"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/auth";

export async function sendLeagueMessage(
  leagueId: string,
  body: string
): Promise<void> {
  const trimmed = body.trim();
  if (trimmed.length < 1 || trimmed.length > 500) {
    throw new Error("Message must be between 1 and 500 characters.");
  }

  const user = await requireAuth();
  const supabase = await createClient();

  // Verify user is a member of this league
  const { data: membership } = await supabase
    .from("league_members")
    .select("user_id")
    .eq("league_id", leagueId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) {
    throw new Error("You must be a member of this league to send messages.");
  }

  const { error } = await supabase.from("league_messages").insert({
    league_id: leagueId,
    user_id: user.id,
    body: trimmed,
  });

  if (error) {
    throw new Error("Failed to send message.");
  }

  revalidatePath(`/leagues/${leagueId}`);
}
