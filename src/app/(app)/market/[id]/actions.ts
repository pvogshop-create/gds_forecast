"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/auth";

const MENTION_RE = /(?<!\w)@(\w+)/g;
const MAX_MENTIONS = 5;
const NOTIFICATION_PREVIEW_LEN = 120;

export async function postComment(
  marketId: string,
  body: string
): Promise<void> {
  const trimmed = body.trim();
  if (trimmed.length < 1 || trimmed.length > 500) {
    throw new Error("Comment must be between 1 and 500 characters.");
  }

  const user = await requireAuth();
  const supabase = await createClient();

  // Fetch commenter's username for the notification body
  const { data: commenterProfile } = await supabase
    .from("profiles")
    .select("username, display_name")
    .eq("id", user.id)
    .single();

  const commenterHandle =
    commenterProfile?.username ??
    commenterProfile?.display_name ??
    "Someone";

  // Insert the comment
  const { data: comment, error: insertError } = await supabase
    .from("market_comments")
    .insert({ market_id: marketId, user_id: user.id, body: trimmed })
    .select("id")
    .single();

  if (insertError || !comment) {
    throw new Error("Failed to post comment.");
  }

  // ── @-mention notifications ──────────────────────────────────────────────
  const rawMatches = [...trimmed.matchAll(MENTION_RE)].map((m) => m[1]);
  const uniqueMentions = [...new Set(rawMatches)].slice(0, MAX_MENTIONS);

  if (uniqueMentions.length > 0) {
    const { data: mentionedProfiles } = await supabase
      .from("profiles")
      .select("id, username")
      .in("username", uniqueMentions);

    for (const mentioned of mentionedProfiles ?? []) {
      // Don't notify yourself
      if (mentioned.id === user.id) continue;

      const preview =
        trimmed.length > NOTIFICATION_PREVIEW_LEN
          ? `${trimmed.slice(0, NOTIFICATION_PREVIEW_LEN)}…`
          : trimmed;

      await supabase.from("notifications").insert({
        user_id: mentioned.id,
        type: "comment_mention",
        title: `@${commenterHandle} mentioned you in a comment`,
        body: preview,
        data: { market_id: marketId, comment_id: comment.id },
      });
    }
  }

  revalidatePath(`/market/${marketId}`);
}

export async function deleteComment(
  commentId: string,
  marketId: string
): Promise<void> {
  const user = await requireAuth();
  const supabase = await createClient();

  // RLS enforces user can only delete their own comment; this is a belt-and-suspenders check
  const { error } = await supabase
    .from("market_comments")
    .delete()
    .eq("id", commentId)
    .eq("user_id", user.id);

  if (error) {
    throw new Error("Failed to delete comment.");
  }

  revalidatePath(`/market/${marketId}`);
}
