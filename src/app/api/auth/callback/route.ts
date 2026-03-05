import { createClient } from "@/lib/supabase/server";
import { NextResponse, type NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  // Guard against open-redirect: only allow same-origin relative paths
  const rawNext = searchParams.get("next") ?? "/dashboard/trending";
  const next =
    rawNext.startsWith("/") && !rawNext.startsWith("//")
      ? rawNext
      : "/dashboard/trending";

  const supabase = await createClient();

  let userId: string | null = null;
  let userEmail: string | null = null;

  if (tokenHash && type) {
    // Magic link / OTP flow
    const { data, error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as "magiclink" | "email",
    });
    if (error || !data.user) {
      console.error("Magic link callback error:", error?.message);
      return NextResponse.redirect(new URL("/login?error=auth_failed", origin));
    }
    userId = data.user.id;
    userEmail = data.user.email ?? null;
  } else if (code) {
    // OAuth PKCE flow
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error || !data.user) {
      console.error("OAuth callback error:", error?.message);
      return NextResponse.redirect(new URL("/login?error=auth_failed", origin));
    }
    userId = data.user.id;
    userEmail = data.user.email ?? null;
  } else {
    return NextResponse.redirect(new URL("/login?error=missing_code", origin));
  }

  // ── Hard enforcement: only @gds.org emails are permitted (admin Gmail exempt) ─
  const email = userEmail ?? "";
  const isGdsUser = email.endsWith("@gds.org");
  const isAdmin = email === process.env.ADMIN_EMAIL;
  if (!isGdsUser && !isAdmin) {
    await supabase.auth.signOut();
    return NextResponse.redirect(
      new URL("/login?error=unauthorized_domain", origin)
    );
  }

  // ── Check if onboarding is needed (username not yet set) ─────────────────
  const { data: profile } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", userId)
    .single();

  if (!profile?.username) {
    return NextResponse.redirect(new URL("/onboarding", origin));
  }

  // Authenticated and onboarded — redirect to destination
  return NextResponse.redirect(new URL(next, origin));
}
