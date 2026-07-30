"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogIn } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/components/ui/Toast";
import { ToastContainer } from "@/components/ui/Toast";

export function JoinLeagueButton() {
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

    // Look up the league by invite code via a SECURITY DEFINER RPC.
    //
    // A direct `from("leagues").eq("invite_code", …)` cannot work here: the
    // leagues SELECT policy is `is_public OR creator OR member`, and someone
    // holding an invite code is none of those yet — so the lookup returned no
    // row and every VALID code was reported as invalid. Leagues default to
    // private, so invite-code joining never worked at all. The RPC (0024)
    // returns only id/name/max_members/member_count/is_member for an exact code
    // match, so nothing about other private leagues is exposed.
    const { data: matches, error: lookupError } = await supabase.rpc(
      "find_league_by_invite_code",
      { p_code: code.trim() }
    );

    const league = Array.isArray(matches) ? matches[0] : matches;

    if (lookupError || !league) {
      setError("Invalid invite code. Please check and try again.");
      setIsLoading(false);
      return;
    }

    if ((league.member_count ?? 0) >= league.max_members) {
      setError("This league is full.");
      setIsLoading(false);
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setError("You must be signed in.");
      setIsLoading(false);
      return;
    }

    if (league.is_member) {
      setIsOpen(false);
      router.push(`/leagues/${league.id}`);
      return;
    }

    const { error: joinError } = await supabase.from("league_members").insert({
      league_id: league.id,
      user_id: user.id,
      role: "member",
    });

    if (joinError) {
      setError("Failed to join league. Please try again.");
      setIsLoading(false);
      return;
    }

    toast.success(`Joined "${league.name}"!`);
    setIsOpen(false);
    setCode("");
    router.refresh();
    router.push(`/leagues/${league.id}`);
  }

  return (
    <>
      <ToastContainer />
      <Button
        variant="secondary"
        size="sm"
        data-testid="join-league-open"
        onClick={() => setIsOpen(true)}
      >
        <LogIn size={14} strokeWidth={2.5} />
        Join
      </Button>

      <Modal
        isOpen={isOpen}
        onClose={() => { setIsOpen(false); setError(null); }}
        title="Join a League"
      >
        <form onSubmit={handleJoin} className="space-y-4">
          <div>
            <label
              htmlFor="invite-code"
              className="block text-xs font-medium mb-1.5"
              style={{ color: "var(--color-ink-secondary)" }}
            >
              Invite code
            </label>
            <input
              id="invite-code"
              data-testid="join-league-code"
              type="text"
              value={code}
              onChange={(e) => { setCode(e.target.value); setError(null); }}
              placeholder="e.g. ABC123"
              maxLength={8}
              required
              autoFocus
              className="w-full px-3 py-2.5 rounded-xl text-sm font-mono tracking-widest uppercase outline-none transition-all duration-150 text-center"
              style={{
                backgroundColor: "var(--color-bg)",
                border: `1px solid ${error ? "var(--color-danger)" : "var(--color-border)"}`,
                color: "var(--color-ink-primary)",
              }}
            />
            {error && (
              <p
                className="text-xs mt-1"
                style={{ color: "var(--color-danger)" }}
                role="alert"
                data-testid="join-league-error"
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
              onClick={() => { setIsOpen(false); setError(null); }}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="md"
              className="flex-1"
              data-testid="join-league-submit"
              isLoading={isLoading}
              disabled={code.trim().length < 4}
            >
              Join League
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
