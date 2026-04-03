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

  // ── 4. Fetch market type to route to the correct stored procedure ────────────
  const admin = createAdminClient();
  const { data: marketMeta } = await admin
    .from("markets")
    .select("market_type")
    .eq("id", marketId)
    .single();

  const rpcName =
    marketMeta?.market_type === "over_under" ? "place_ou_bet" : "place_bet";

  // ── 5. Call the appropriate stored procedure ───────────────────────────────
  const { data, error } = await admin.rpc(rpcName, {
    p_market_id: marketId,
    p_user_id: user.id,
    p_side: side,
    p_coins: coins,
  });

  if (error) {
    // P0001 = Postgres SQLSTATE for RAISE EXCEPTION without a custom ERRCODE.
    // All business-logic exceptions use plain RAISE EXCEPTION, so they all
    // carry P0001 and are safe to surface to the client as 400 errors.
    const isDomainError = error.code === "P0001";

    // Map known business-logic messages to user-friendly copy
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
    } else if (msg.includes("calibration period")) {
      clientMessage =
        "Max bet is 100 coins during the first 5 bets on a new market.";
    } else if (msg.includes("no line set")) {
      clientMessage = "This market does not have a line set yet.";
    }

    return NextResponse.json(
      { error: clientMessage },
      { status: isDomainError ? 400 : 500 }
    );
  }

  return NextResponse.json({ success: true, result: data });
}
