import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function POST() {
  try {
    const user = await requireAuth();
    const supabase = await createClient();

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
