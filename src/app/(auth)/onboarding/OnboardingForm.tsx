"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,20}$/;

interface OnboardingFormProps {
  userId: string;
  displayName: string | null;
}

export function OnboardingForm({ userId, displayName }: OnboardingFormProps) {
  const router = useRouter();
  const [username, setUsername] = useState(
    // Pre-fill from display name if possible
    displayName
      ? displayName.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "").slice(0, 20)
      : ""
  );
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  function validateUsername(value: string): string | null {
    if (!value) return "Username is required.";
    if (!USERNAME_REGEX.test(value)) {
      return "Username must be 3–20 characters: letters, numbers, and underscores only.";
    }
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validationError = validateUsername(username);
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    setIsLoading(true);

    const supabase = createClient();

    // Check uniqueness
    const { data: existing } = await supabase
      .from("profiles")
      .select("id")
      .eq("username", username.toLowerCase())
      .maybeSingle();

    if (existing) {
      setError("This username is already taken. Please choose another.");
      setIsLoading(false);
      return;
    }

    const { error: updateError } = await supabase
      .from("profiles")
      .update({ username: username.toLowerCase() })
      .eq("id", userId);

    if (updateError) {
      setError("Failed to set username. Please try again.");
      setIsLoading(false);
      return;
    }

    router.push("/dashboard/trending");
  }

  const validationError = username ? validateUsername(username) : null;
  const isValid = username.length > 0 && !validationError;

  return (
    <form onSubmit={handleSubmit} noValidate>
      <label
        htmlFor="username"
        className="block text-sm font-medium mb-2"
        style={{ color: "var(--color-ink-primary)" }}
      >
        Choose a username
      </label>
      <input
        id="username"
        type="text"
        value={username}
        onChange={(e) => {
          setUsername(e.target.value);
          if (error) setError(null);
        }}
        onBlur={() => {
          if (username) setError(validateUsername(username));
        }}
        placeholder="e.g. johndoe_99"
        maxLength={20}
        autoComplete="username"
        autoFocus
        className="w-full px-4 py-3 rounded-xl text-sm mb-1 transition-all duration-200 outline-none"
        style={{
          backgroundColor: "var(--color-bg)",
          border: `1px solid ${error ? "var(--color-danger)" : "var(--color-border)"}`,
          color: "var(--color-ink-primary)",
        }}
        data-testid="onboarding-username"
        aria-describedby={error ? "username-error" : undefined}
        aria-invalid={!!error}
      />

      {/* Validation message */}
      {error && (
        <p
          id="username-error"
          data-testid="onboarding-error"
          className="text-xs mb-3"
          style={{ color: "var(--color-danger)" }}
          role="alert"
        >
          {error}
        </p>
      )}
      {!error && username && (
        <p
          className="text-xs mb-3"
          style={{ color: "var(--color-ink-tertiary)" }}
        >
          {20 - username.length} characters remaining
        </p>
      )}
      {!username && (
        <p
          className="text-xs mb-3"
          style={{ color: "var(--color-ink-tertiary)" }}
        >
          3–20 characters: letters, numbers, underscores
        </p>
      )}

      <button
        type="submit"
        data-testid="onboarding-submit"
        disabled={!isValid || isLoading}
        className="w-full py-3 px-4 rounded-xl font-semibold text-sm transition-all duration-200"
        style={{
          backgroundColor:
            isValid && !isLoading
              ? "var(--color-btn)"
              : "var(--color-bg-subtle)",
          color: isValid && !isLoading ? "white" : "var(--color-ink-tertiary)",
          cursor: isValid && !isLoading ? "pointer" : "not-allowed",
        }}
      >
        {isLoading ? "Setting up…" : "Get started →"}
      </button>
    </form>
  );
}
