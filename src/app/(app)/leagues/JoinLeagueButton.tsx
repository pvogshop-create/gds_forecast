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

    // Look up league by invite code
    const { data: league } = await supabase
      .from("leagues")
      .select("id, name, max_members")
      .eq("invite_code", code.trim().toUpperCase())
      .single();

    if (!league) {
      setError("Invalid invite code. Please check and try again.");
      setIsLoading(false);
      return;
    }

    // Check member count
    const { count } = await supabase
      .from("league_members")
      .select("*", { count: "exact", head: true })
      .eq("league_id", league.id);

    if ((count ?? 0) >= league.max_members) {
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

    // Check if already a member
    const { data: existing } = await supabase
      .from("league_members")
      .select("league_id")
      .eq("league_id", league.id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (existing) {
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
