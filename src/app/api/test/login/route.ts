import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/test/login — programmatic sign-in for the Playwright E2E suite.
 *
 * Production auth is magic-link only (`signInWithOtp`), which a browser test
 * cannot complete without scraping a mailbox. This route trades a one-time
 * password for a real SSR session instead.
 *
 * Three gates, in order:
 *   1. 404 unless E2E is explicitly enabled (never in production, never without
 *      E2E_TEST_SECRET set). A 404 rather than a 403 so the route is
 *      indistinguishable from a nonexistent path in a real deployment.
 *   2. 404 on a missing `x-e2e-secret` header — same reasoning.
 *   3. 401 only once the caller has proven it knows the route exists.
 *
 * It deliberately reuses the app's own `createClient()` from
 * src/lib/supabase/server.ts rather than hand-rolling cookies: because this is a
 * Route Handler (not a Server Component) `cookieStore.set` succeeds, so
 * @supabase/ssr writes the chunked `sb-*` session cookies itself, in exactly the
 * shape the rest of the app and the middleware expect.
 *
 * Note src/proxy.ts must also treat `/api/test` as public under the same gate,
 * or middleware redirects this unauthenticated POST to /login before it runs.
 */

const E2E_ENABLED =
  process.env.NODE_ENV !== "production" && !!process.env.E2E_TEST_SECRET;

function notFound() {
  return new NextResponse(null, { status: 404 });
}

export async function POST(request: NextRequest) {
  if (!E2E_ENABLED) return notFound();

  const provided = request.headers.get("x-e2e-secret");
  if (!provided) return notFound();
  if (provided !== process.env.E2E_TEST_SECRET) {
    return NextResponse.json({ error: "Bad secret" }, { status: 401 });
  }

  let body: { email?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) {
    return NextResponse.json(
      { error: "email and password are required" },
      { status: 400 }
    );
  }

  // Guard against ever pointing this at a real project. The seeded fixtures all
  // live on the reserved `.test` TLD (RFC 2606), so a request for any other
  // domain means the harness is misconfigured.
  if (!email.endsWith("@forecast.test")) {
    return NextResponse.json(
      { error: "Test login only accepts @forecast.test addresses" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  // Confirm the fixture exists before attempting a sign-in, so a seeding bug
  // reports as "user not seeded" rather than an opaque invalid-credentials error.
  // Matches the seeder's page size (e2e/helpers/seed.ts). A smaller cap here
  // would make an existing fixture look missing once a local database has
  // accumulated enough users, and report a misleading "did global setup run?".
  const { data: list, error: listError } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (listError) {
    return NextResponse.json({ error: listError.message }, { status: 500 });
  }
  const authUser = list.users.find((u) => u.email === email);
  if (!authUser) {
    return NextResponse.json(
      { error: `Test user ${email} does not exist. Did global setup run?` },
      { status: 404 }
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.user) {
    return NextResponse.json(
      { error: error?.message ?? "Sign-in failed" },
      { status: 401 }
    );
  }

  return NextResponse.json({ userId: data.user.id, email: data.user.email });
}
