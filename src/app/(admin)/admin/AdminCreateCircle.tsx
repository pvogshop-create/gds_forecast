"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { toast, ToastContainer } from "@/components/ui/Toast";
import { createCircle } from "./actions";
import type { CircleJoiningPolicy } from "@/types/database";

const POLICIES: {
  value: CircleJoiningPolicy;
  label: string;
  hint: string;
  disabled?: boolean;
}[] = [
  {
    value: "invite_code",
    label: "Invite code",
    hint: "Hidden from everyone else. Members join with the code.",
  },
  {
    value: "open",
    label: "Open",
    hint: "Anyone signed in can find it and join.",
  },
  {
    value: "request_approval",
    label: "Request to join",
    hint: "Not built yet — join requests land in a later migration.",
    disabled: true,
  },
];

/** Mirrors the ^[a-z0-9-]{3,40}$ CHECK on `circles.slug`, and the server-side
 *  slugify in actions.ts. Duplicated deliberately: this one gives live feedback
 *  as you type, the server one is the authority. */
function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
}

export function AdminCreateCircle() {
  const formRef = useRef<HTMLFormElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  /** Once the admin edits the slug by hand, stop overwriting it from the name. */
  const [slugTouched, setSlugTouched] = useState(false);
  const [policy, setPolicy] = useState<CircleJoiningPolicy>("invite_code");

  const effectiveSlug = slugTouched ? slug : slugify(name);
  const slugError =
    effectiveSlug.length > 0 && !/^[a-z0-9-]{3,40}$/.test(effectiveSlug)
      ? "3–40 characters: lowercase letters, numbers and hyphens only."
      : null;

  const isSubmitDisabled =
    isLoading || !name.trim() || effectiveSlug.length < 3 || !!slugError;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsLoading(true);

    const formData = new FormData(e.currentTarget);
    formData.set("slug", effectiveSlug);
    formData.set("joining_policy", policy);

    try {
      await createCircle(formData);
      toast.success(`Circle "${name.trim()}" created.`);
      formRef.current?.reset();
      setName("");
      setSlug("");
      setSlugTouched(false);
      setPolicy("invite_code");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create circle.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <>
      <ToastContainer />
      <section>
        <h2
          className="font-semibold text-sm mb-3"
          style={{ color: "var(--color-ink-primary)" }}
        >
          Create Circle
        </h2>
        <form
          ref={formRef}
          onSubmit={handleSubmit}
          className="rounded-xl p-5 space-y-4"
          style={{
            backgroundColor: "var(--color-bg-card)",
            border: "1px solid var(--color-border)",
            boxShadow: "var(--shadow-card)",
          }}
        >
          <div>
            <label
              htmlFor="circle-name"
              className="block text-xs font-medium mb-1.5"
              style={{ color: "var(--color-ink-secondary)" }}
            >
              Circle name *
            </label>
            <input
              id="circle-name"
              name="name"
              data-testid="admin-circle-name"
              type="text"
              required
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Lincoln High"
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
              htmlFor="circle-slug"
              className="block text-xs font-medium mb-1.5"
              style={{ color: "var(--color-ink-secondary)" }}
            >
              URL slug *
            </label>
            <input
              id="circle-slug"
              data-testid="admin-circle-slug"
              type="text"
              maxLength={40}
              value={effectiveSlug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(slugify(e.target.value));
              }}
              placeholder="lincoln-high"
              aria-describedby="circle-slug-hint"
              className="w-full px-3 py-2.5 rounded-xl text-sm font-mono outline-none transition-all duration-150"
              style={{
                backgroundColor: "var(--color-bg)",
                border: `1px solid ${slugError ? "var(--color-danger)" : "var(--color-border)"}`,
                color: "var(--color-ink-primary)",
              }}
            />
            {slugError ? (
              <p
                id="circle-slug-hint"
                className="text-xs mt-1"
                style={{ color: "var(--color-danger)" }}
                role="alert"
              >
                {slugError}
              </p>
            ) : (
              <p
                id="circle-slug-hint"
                className="text-xs mt-1"
                style={{ color: "var(--color-ink-tertiary)" }}
              >
                /circles/{effectiveSlug || "…"}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="circle-description"
              className="block text-xs font-medium mb-1.5"
              style={{ color: "var(--color-ink-secondary)" }}
            >
              Description
            </label>
            <textarea
              id="circle-description"
              name="description"
              data-testid="admin-circle-description"
              maxLength={300}
              rows={2}
              placeholder="Who is this circle for?"
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none transition-all duration-150 resize-none"
              style={{
                backgroundColor: "var(--color-bg)",
                border: "1px solid var(--color-border)",
                color: "var(--color-ink-primary)",
              }}
            />
          </div>

          <fieldset>
            <legend
              className="block text-xs font-medium mb-1.5"
              style={{ color: "var(--color-ink-secondary)" }}
            >
              How people join
            </legend>
            <div className="flex flex-wrap gap-2">
              {POLICIES.map((p) => {
                const isActive = policy === p.value;
                return (
                  <button
                    key={p.value}
                    type="button"
                    disabled={p.disabled}
                    aria-pressed={isActive}
                    title={p.hint}
                    data-testid={`admin-circle-policy-${p.value}`}
                    onClick={() => setPolicy(p.value)}
                    className="px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{
                      backgroundColor: isActive
                        ? "var(--color-primary)"
                        : "var(--color-bg)",
                      border: `1px solid ${isActive ? "var(--color-primary)" : "var(--color-border)"}`,
                      color: isActive ? "#fff" : "var(--color-ink-secondary)",
                    }}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
            <p className="text-xs mt-1.5" style={{ color: "var(--color-ink-tertiary)" }}>
              {POLICIES.find((p) => p.value === policy)?.hint}
            </p>
          </fieldset>

          <Button
            type="submit"
            variant="primary"
            size="md"
            className="w-full"
            data-testid="admin-circle-submit"
            isLoading={isLoading}
            disabled={isSubmitDisabled}
          >
            Create Circle
          </Button>
        </form>
      </section>
    </>
  );
}
