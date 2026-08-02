"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogIn } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";
import { toast, ToastContainer } from "@/components/ui/Toast";
import type { FindCircleByCodeResult } from "@/types/database";

export function JoinCircleButton() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;

    setError(null);
    setIsLoading(true);
    const supabase = createClient();

    try {
      // Resolve the circle through a SECURITY DEFINER RPC, not a direct
      // `.eq('invite_code', …)`. circles_select is "member OR open", and someone
      // holding an invite code is neither yet — a direct lookup returns no row
      // and reports every VALID code as invalid. That exact bug shipped in
      // leagues and went unnoticed for months (fixed in 0024); this is the same
      // shape, avoided.
      const { data: matches, error: lookupError } = await supabase.rpc(
        "find_circle_by_invite_code",
        { p_code: code.trim() }
      );

      const circle = (
        Array.isArray(matches) ? matches[0] : matches
      ) as FindCircleByCodeResult | undefined;

      if (lookupError || !circle) {
        setError("Invalid invite code. Please check and try again.");
        return;
      }

      if (circle.is_member) {
        setIsOpen(false);
        router.push(`/circles/${circle.slug}`);
        return;
      }

      // The cap is re-checked inside join_circle() under the circle's row lock;
      // this is only so a full circle reads as "full" rather than as a generic
      // failure. Never treat it as the enforcement point.
      if (circle.member_count >= circle.max_members) {
        setError("This circle is full.");
        return;
      }

      const { error: joinError } = await supabase.rpc("join_circle", {
        p_circle_id: circle.id,
        p_invite_code: code.trim(),
      });

      if (joinError) {
        setError(joinError.message || "Failed to join circle. Please try again.");
        return;
      }

      toast.success(`Joined "${circle.name}"!`);
      setIsOpen(false);
      setCode("");
      router.refresh();
      router.push(`/circles/${circle.slug}`);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <>
      <ToastContainer />
      <Button
        variant="secondary"
        size="sm"
        data-testid="join-circle-open"
        onClick={() => setIsOpen(true)}
      >
        <LogIn size={14} strokeWidth={2.5} />
        Join
      </Button>

      <Modal
        isOpen={isOpen}
        onClose={() => {
          setIsOpen(false);
          setError(null);
        }}
        title="Join a Circle"
      >
        <form onSubmit={handleJoin} className="space-y-4">
          <div>
            <label
              htmlFor="circle-invite-code"
              className="block text-xs font-medium mb-1.5"
              style={{ color: "var(--color-ink-secondary)" }}
            >
              Invite code
            </label>
            <input
              id="circle-invite-code"
              data-testid="join-circle-code"
              type="text"
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                setError(null);
              }}
              placeholder="e.g. AB12CD34"
              maxLength={8}
              required
              autoFocus
              autoComplete="off"
              aria-describedby={error ? "join-circle-error" : undefined}
              className="w-full px-3 py-2.5 rounded-xl text-sm font-mono tracking-widest uppercase outline-none transition-all duration-150 text-center"
              style={{
                backgroundColor: "var(--color-bg)",
                border: `1px solid ${error ? "var(--color-danger)" : "var(--color-border)"}`,
                color: "var(--color-ink-primary)",
              }}
            />
            {error && (
              <p
                id="join-circle-error"
                className="text-xs mt-1"
                style={{ color: "var(--color-danger)" }}
                role="alert"
                data-testid="join-circle-error"
              >
                {error}
              </p>
            )}
          </div>

          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              size="md"
              className="flex-1"
              onClick={() => {
                setIsOpen(false);
                setError(null);
              }}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="md"
              className="flex-1"
              data-testid="join-circle-submit"
              isLoading={isLoading}
              disabled={code.trim().length < 4}
            >
              Join Circle
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
