"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/auth";

/**
 * Leave a circle.
 *
 * Runs through the user's own session client, not the admin client, so
 * `circle_members_delete` is the thing that authorizes it — the policy allows
 * `user_id = auth.uid()` for any row whose role is not 'creator'. Doing this
 * with service_role would bypass RLS and quietly make the creator-protection
 * rule unenforceable from here.
 *
 * A denied DELETE does not error under RLS; it matches zero rows. So success is
 * confirmed by reading back, not by the absence of an error.
 */
export async function leaveCircle(circleId: string): Promise<void> {
  const user = await requireAuth();
  const supabase = await createClient();

  const { error } = await supabase
    .from("circle_members")
    .delete()
    .eq("circle_id", circleId)
    .eq("user_id", user.id);

  if (error) {
    throw new Error("Failed to leave circle.");
  }

  const { data: still } = await supabase
    .from("circle_members")
    .select("user_id")
    .eq("circle_id", circleId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (still) {
    throw new Error(
      "You can't leave a circle you created. Ask an admin to remove it instead."
    );
  }

  revalidatePath("/circles");
  revalidatePath(`/circles/${circleId}`);
}

/**
 * Remove another member. Authorized by the same policy: a moderator may delete
 * any non-creator row in their circle.
 */
export async function removeCircleMember(
  circleId: string,
  memberUserId: string
): Promise<void> {
  await requireAuth();
  const supabase = await createClient();

  const { error } = await supabase
    .from("circle_members")
    .delete()
    .eq("circle_id", circleId)
    .eq("user_id", memberUserId);

  if (error) {
    throw new Error("Failed to remove member.");
  }

  revalidatePath("/circles");
}
