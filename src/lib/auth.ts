import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import type { Profile } from "@/types/database";

// Fetch the authenticated user's Supabase Auth user object.
// Returns null if not authenticated.
export async function getUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;
  return user;
}

// Require authentication — redirects to /login if not authenticated.
export async function requireAuth() {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}

// Require admin access — server-side validated against ADMIN_EMAIL env var.
// Two-layer protection: middleware fast-fail + this server-side check.
export async function requireAdmin() {
  const user = await requireAuth();
  if (user.email !== process.env.ADMIN_EMAIL) {
    redirect("/dashboard/trending");
  }
  return user;
}

// Fetch a user's profile row from the profiles table.
export async function getProfile(userId: string): Promise<Profile | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();
  return data as Profile | null;
}

// Require authentication + completed onboarding (username set).
// Redirects to /onboarding if username is null.
export async function requireOnboarding(): Promise<{
  user: Awaited<ReturnType<typeof requireAuth>>;
  profile: Profile;
}> {
  const user = await requireAuth();
  const profile = await getProfile(user.id);

  if (!profile) {
    // Profile should always exist (created by DB trigger), but guard just in case
    redirect("/login");
  }

  if (!profile.username) {
    redirect("/onboarding");
  }

  return { user, profile };
}

// Check if the current user is the admin (used in UI to show/hide admin links)
export async function isAdmin(): Promise<boolean> {
  const user = await getUser();
  return user?.email === process.env.ADMIN_EMAIL;
}
