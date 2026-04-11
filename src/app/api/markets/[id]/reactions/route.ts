import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

const ALLOWED_EMOJIS = ["🔥", "🎯", "🤔", "💰", "✅"] as const;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: marketId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: rows, error } = await supabase
    .from("market_reactions")
    .select("emoji, user_id")
    .eq("market_id", marketId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Aggregate counts per emoji and whether the current user reacted
  const reactions = ALLOWED_EMOJIS.map((emoji) => {
    const matching = (rows ?? []).filter((r) => r.emoji === emoji);
    return {
      emoji,
      count: matching.length,
      reacted: user ? matching.some((r) => r.user_id === user.id) : false,
    };
  });

  return NextResponse.json({ reactions });
}
