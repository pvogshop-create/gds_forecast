"use client";

import { createClient } from "@/lib/supabase/client";
import { useState } from "react";

type Mode = "idle" | "loading" | "sent" | "error";

export function LoginButton() {
  const [email, setEmail] = useState("");
  const [mode, setMode] = useState<Mode>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();

    if (!trimmed) {
      setErrorMsg("Please enter your email address.");
      setMode("error");
      return;
    }

    // Basic email format check — server enforces domain rules
    if (!trimmed.includes("@") || !trimmed.includes(".")) {
      setErrorMsg("Please enter a valid email address.");
      setMode("error");
      return;
    }

    setMode("loading");
    setErrorMsg("");
    const supabase = createClient();

    const { error } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: {
        emailRedirectTo: `${window.location.origin}/api/auth/callback`,
        shouldCreateUser: false,
      },
    });

    if (error) {
      setErrorMsg(error.message);
      setMode("error");
    } else {
      setMode("sent");
    }
  }

  if (mode === "sent") {
    return (
      <div
        className="rounded-xl p-4 text-center space-y-2"
        style={{
          backgroundColor: "var(--color-primary-light)",
          border: "1px solid var(--color-primary)",
        }}
      >
        <p className="text-2xl">📬</p>
        <p className="text-sm font-semibold" style={{ color: "var(--color-primary)" }}>
          Check your email
        </p>
        <p className="text-xs" style={{ color: "var(--color-ink-secondary)" }}>
          We sent a sign-in link to <strong>{email}</strong>. Click it to log
          in — no password needed.
        </p>
        <button
          onClick={() => { setMode("idle"); setEmail(""); }}
          className="text-xs underline mt-1"
          style={{ color: "var(--color-ink-tertiary)" }}
        >
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleMagicLink} className="space-y-2">
      <input
        type="email"
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
          if (mode === "error") setMode("idle");
        }}
        placeholder="yourname@gds.org"
        autoComplete="email"
        autoFocus
        className="w-full px-4 py-3 rounded-xl text-sm outline-none transition-all duration-150"
        style={{
          backgroundColor: "var(--color-bg)",
          border: `1px solid ${mode === "error" ? "var(--color-danger)" : "var(--color-border)"}`,
          color: "var(--color-ink-primary)",
        }}
      />
      {mode === "error" && (
        <p className="text-xs" style={{ color: "var(--color-danger)" }} role="alert">
          {errorMsg}
        </p>
      )}
      <button
        type="submit"
        disabled={mode === "loading"}
        className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-semibold text-sm text-white transition-all duration-200"
        style={{
          backgroundColor: "var(--color-primary)",
          opacity: mode === "loading" ? 0.7 : 1,
          cursor: mode === "loading" ? "not-allowed" : "pointer",
        }}
      >
        {mode === "loading" ? (
          <>
            <div
              className="w-4 h-4 border-2 rounded-full animate-spin"
              style={{ borderColor: "rgba(255,255,255,0.3)", borderTopColor: "white" }}
            />
            Sending link…
          </>
        ) : (
          "Send sign-in link →"
        )}
      </button>
    </form>
  );
}
