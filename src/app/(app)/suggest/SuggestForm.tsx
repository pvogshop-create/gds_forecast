"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/components/ui/Toast";
import { ToastContainer } from "@/components/ui/Toast";
import type { MarketCategory } from "@/types/database";

const CATEGORIES: { value: MarketCategory; label: string; emoji: string }[] = [
  { value: "sports", label: "Sports", emoji: "🏆" },
  { value: "actions", label: "Actions", emoji: "⚡" },
  { value: "social", label: "Social", emoji: "👥" },
  { value: "trending", label: "Trending", emoji: "📈" },
];

interface SuggestFormProps {
  userId: string;
}

export function SuggestForm({ userId }: SuggestFormProps) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<MarketCategory>("actions");
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !description.trim()) return;

    setIsLoading(true);
    const supabase = createClient();

    const { error } = await supabase.from("market_suggestions").insert({
      user_id: userId,
      title: title.trim(),
      description: description.trim(),
      category,
    });

    if (error) {
      toast.error("Failed to submit suggestion. Please try again.");
      setIsLoading(false);
      return;
    }

    toast.success("Suggestion submitted! An admin will review it.");
    setTitle("");
    setDescription("");
    setCategory("actions");
    router.refresh();
    setIsLoading(false);
  }

  return (
    <>
      <ToastContainer />
      <form
        onSubmit={handleSubmit}
        className="rounded-xl p-5 space-y-4"
        style={{
          backgroundColor: "var(--color-bg-card)",
          border: "1px solid var(--color-border)",
          boxShadow: "var(--shadow-card)",
        }}
      >
        {/* Title */}
        <div>
          <label
            htmlFor="suggest-title"
            className="block text-xs font-medium mb-1.5"
            style={{ color: "var(--color-ink-secondary)" }}
          >
            Market title *
          </label>
          <input
            id="suggest-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Will GDS win the championship?"
            maxLength={150}
            required
            className="w-full px-3 py-2.5 rounded-xl text-sm outline-none transition-all duration-150"
            style={{
              backgroundColor: "var(--color-bg)",
              border: "1px solid var(--color-border)",
              color: "var(--color-ink-primary)",
            }}
          />
          <p
            className="text-xs mt-1"
            style={{ color: "var(--color-ink-tertiary)" }}
          >
            {150 - title.length} characters remaining
          </p>
        </div>

        {/* Description */}
        <div>
          <label
            htmlFor="suggest-description"
            className="block text-xs font-medium mb-1.5"
            style={{ color: "var(--color-ink-secondary)" }}
          >
            Description & resolution criteria *
          </label>
          <textarea
            id="suggest-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="When should this resolve? What counts as YES vs NO?"
            maxLength={500}
            rows={4}
            required
            className="w-full px-3 py-2.5 rounded-xl text-sm outline-none transition-all duration-150 resize-none"
            style={{
              backgroundColor: "var(--color-bg)",
              border: "1px solid var(--color-border)",
              color: "var(--color-ink-primary)",
            }}
          />
        </div>

        {/* Category */}
        <div>
          <p
            className="block text-xs font-medium mb-2"
            style={{ color: "var(--color-ink-secondary)" }}
          >
            Category
          </p>
          <div className="grid grid-cols-2 gap-2">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.value}
                type="button"
                onClick={() => setCategory(cat.value)}
                className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150"
                style={{
                  backgroundColor:
                    category === cat.value
                      ? "var(--color-primary-light)"
                      : "var(--color-bg)",
                  border: `1px solid ${
                    category === cat.value
                      ? "var(--color-primary)"
                      : "var(--color-border)"
                  }`,
                  color:
                    category === cat.value
                      ? "var(--color-primary)"
                      : "var(--color-ink-secondary)",
                }}
              >
                <span>{cat.emoji}</span>
                <span>{cat.label}</span>
              </button>
            ))}
          </div>
        </div>

        <Button
          type="submit"
          variant="primary"
          size="md"
          className="w-full"
          isLoading={isLoading}
          disabled={!title.trim() || !description.trim()}
        >
          Submit Suggestion
        </Button>
      </form>
    </>
  );
}
