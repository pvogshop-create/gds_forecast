import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Server Supabase client — used in Server Components and Route Handlers.
// Reads and writes session cookies for SSR auth.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component — cookies are read-only here.
            // The middleware handles refreshing the session cookie.
          }
        },
      },
    }
  );
}
