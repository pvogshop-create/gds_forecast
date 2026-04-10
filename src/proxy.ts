import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Routes that are accessible without authentication
const PUBLIC_ROUTES = ["/login", "/api/auth"];

// Parsed once at module load — avoids per-request string splitting
const ADMIN_EMAILS: ReadonlySet<string> = new Set(
  (process.env.ADMIN_EMAIL ?? "").split(",").map((e) => e.trim()).filter(Boolean)
);

// Routes that require admin access
const ADMIN_ROUTES = ["/admin"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  let response = NextResponse.next({ request });

  // Build a Supabase client that can read/write cookies via proxy
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          // Rebuild response with updated cookies
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh the session — required for SSR auth to work correctly
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublicRoute = PUBLIC_ROUTES.some((r) => pathname.startsWith(r));
  const isAdminRoute = ADMIN_ROUTES.some((r) => pathname.startsWith(r));

  // Unauthenticated: allow only public routes
  if (!user && !isPublicRoute) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Authenticated: redirect /login to the app
  if (user && pathname === "/login") {
    return NextResponse.redirect(
      new URL("/dashboard/trending", request.url)
    );
  }

  // Admin routes: fast-fail if not admin
  // NOTE: Server Components also call requireAdmin() for double protection.
  if (isAdminRoute && !ADMIN_EMAILS.has(user?.email ?? "")) {
    return NextResponse.redirect(
      new URL("/dashboard/trending", request.url)
    );
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths EXCEPT:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico, sitemap.xml, robots.txt
     * - image files
     */
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
