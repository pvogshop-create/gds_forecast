import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";

const ALLOWED_EMOJIS = ["🔥", "🎯", "🤔", "💰", "✅"] as const;

const ReactSchema = z.object({
  emoji: z.enum(ALLOWED_EMOJIS),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: marketId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Validate body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = ReactSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid emoji" }, { status: 400 });
  }

  const { emoji } = parsed.data;

  // Check if reaction already exists (toggle)
  const { data: existing } = await supabase
    .from("market_reactions")
    .select("emoji")
    .eq("market_id", marketId)
    .eq("user_id", user.id)
    .eq("emoji", emoji)
    .maybeSingle();

  let reacted: boolean;

  if (existing) {
    // Remove reaction
    await supabase
      .from("market_reactions")
      .delete()
      .eq("market_id", marketId)
      .eq("user_id", user.id)
      .eq("emoji", emoji);
    reacted = false;
  } else {
    // Add reaction
    await supabase.from("market_reactions").insert({
      market_id: marketId,
      user_id: user.id,
      emoji,
    });
    reacted = true;
  }

  // Return updated count for this emoji
  const { count } = await supabase
    .from("market_reactions")
    .select("*", { count: "exact", head: true })
    .eq("market_id", marketId)
    .eq("emoji", emoji);

  return NextResponse.json({ emoji, count: count ?? 0, reacted });
}
