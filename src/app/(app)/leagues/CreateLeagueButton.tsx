"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/components/ui/Toast";
import { ToastContainer } from "@/components/ui/Toast";

interface CreateLeagueButtonProps {
  userId: string;
}

export function CreateLeagueButton({ userId }: CreateLeagueButtonProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    setIsLoading(true);
    const supabase = createClient();

    const { data, error } = await supabase
      .from("leagues")
      .insert({
        name: name.trim(),
        description: description.trim() || null,
        creator_id: userId,
      })
      .select("id")
      .single();

    if (error || !data) {
      toast.error("Failed to create league. Please try again.");
      setIsLoading(false);
      return;
    }

    // Add creator as owner
    await supabase.from("league_members").insert({
      league_id: data.id,
      user_id: userId,
      role: "owner",
    });

    setIsOpen(false);
    setName("");
    setDescription("");
    router.refresh();
    router.push(`/leagues/${data.id}`);
  }

  return (
    <>
      <ToastContainer />
      <Button
        variant="primary"
        size="sm"
        onClick={() => setIsOpen(true)}
      >
        <Plus size={14} strokeWidth={2.5} />
        Create
      </Button>

      <Modal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title="Create a League"
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label
              htmlFor="league-name"
              className="block text-xs font-medium mb-1.5"
              style={{ color: "var(--color-ink-secondary)" }}
            >
              League name *
            </label>
            <input
              id="league-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. The Forecasters"
              maxLength={50}
              required
              autoFocus
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none transition-all duration-150"
              style={{
                backgroundColor: "var(--color-bg)",
                border: "1px solid var(--color-border)",
                color: "var(--color-ink-primary)",
              }}
            />
          </div>

          <div>
            <label
              htmlFor="league-desc"
              className="block text-xs font-medium mb-1.5"
              style={{ color: "var(--color-ink-secondary)" }}
            >
              Description (optional)
            </label>
            <textarea
              id="league-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What's this league about?"
              maxLength={200}
              rows={3}
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none transition-all duration-150 resize-none"
              style={{
                backgroundColor: "var(--color-bg)",
                border: "1px solid var(--color-border)",
                color: "var(--color-ink-primary)",
              }}
            />
          </div>

          <div className="flex gap-2 pt-1">
            <Button
              type="button"
              variant="secondary"
              size="md"
              className="flex-1"
              onClick={() => setIsOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="md"
              className="flex-1"
              isLoading={isLoading}
              disabled={!name.trim()}
            >
              Create League
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
