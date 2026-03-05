import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";

const BetSchema = z.object({
  side: z.enum(["yes", "no"]),
  coins: z.number().int().min(10).max(500),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // ── 1. Authenticate ────────────────────────────────────────────────────────
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── 2. Parse and validate request body ─────────────────────────────────────
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = BetSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { side, coins } = parsed.data;
  const { id: marketId } = await params;

  // ── 3. Validate marketId is a well-formed UUID ──────────────────────────────
  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(marketId)) {
    return NextResponse.json({ error: "Invalid market ID" }, { status: 400 });
  }

  // ── 4. Call place_bet() via admin client (service_role bypasses RLS) ────────
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("place_bet", {
    p_market_id: marketId,
    p_user_id: user.id,
    p_side: side,
    p_coins: coins,
  });

  if (error) {
    // Map Postgres exception messages to user-friendly responses
    const msg = error.message;
    let clientMessage = "Failed to place bet. Please try again.";

    if (msg.includes("Insufficient coins")) {
      clientMessage = "You don't have enough coins for this bet.";
    } else if (msg.includes("not open")) {
      clientMessage = "This market is not currently accepting bets.";
    } else if (msg.includes("expired")) {
      clientMessage = "This market has expired and is now closed.";
    } else if (msg.includes("Minimum bet")) {
      clientMessage = "Minimum bet is 10 coins.";
    } else if (msg.includes("Maximum bet")) {
      clientMessage = "Maximum bet is 500 coins per position.";
    } else if (msg.includes("price is at its limit")) {
      clientMessage =
        "Market price is at its limit. Cannot bet further in this direction.";
    }

    // Domain errors (invalid input, business rules) → 400; everything else → 500
    const isDomainError =
      msg.includes("Insufficient coins") ||
      msg.includes("not open") ||
      msg.includes("expired") ||
      msg.includes("Minimum bet") ||
      msg.includes("Maximum bet") ||
      msg.includes("price is at its limit") ||
      msg.includes("Unauthorized");
    return NextResponse.json(
      { error: clientMessage },
      { status: isDomainError ? 400 : 500 }
    );
  }

  return NextResponse.json({ success: true, result: data });
}
