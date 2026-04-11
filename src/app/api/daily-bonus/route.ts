import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST() {
  try {
    const user = await requireAuth();
    // Must use service_role client — the prevent_coin_manipulation trigger
    // blocks coins updates when auth.role() = 'authenticated'.
    const supabase = createAdminClient();

    const { data, error } = await supabase.rpc("claim_daily_bonus", {
      p_user_id: user.id,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json(data as { award: number; coins_after: number });
  } catch {
    return NextResponse.json({ error: "Could not claim bonus." }, { status: 500 });
  }
}
