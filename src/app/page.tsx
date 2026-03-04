import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

// Root route: redirect based on auth state
export default async function RootPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/dashboard/trending");
  } else {
    redirect("/login");
  }
}
