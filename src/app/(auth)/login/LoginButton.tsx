"use client";

import { createClient } from "@/lib/supabase/client";
import { useState } from "react";

type Mode = "idle" | "loading" | "sent" | "error";

export function LoginButton() {
  const [email, setEmail] = useState("");
  const [mode, setMode] = useState<Mode>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [googleLoading, setGoogleLoading] = useState(false);

  async function handleGoogle() {
    setGoogleLoading(true);
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/api/auth/callback`,
        queryParams: { prompt: "select_account" },
      },
    });
  }

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();

    if (!trimmed) {
      setErrorMsg("Please enter your email address.");
      setMode("error");
      return;
    }
    if (!trimmed.endsWith("@gds.org")) {
      setErrorMsg("Only @gds.org email addresses are allowed.");
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
        shouldCreateUser: true,
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
    <div className="space-y-4">
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

      <div className="flex items-center gap-3">
        <div className="flex-1 h-px" style={{ backgroundColor: "var(--color-border)" }} />
        <span className="text-xs" style={{ color: "var(--color-ink-tertiary)" }}>or</span>
        <div className="flex-1 h-px" style={{ backgroundColor: "var(--color-border)" }} />
      </div>

      <button
        onClick={handleGoogle}
        disabled={googleLoading}
        className="w-full flex items-center justify-center gap-3 py-3 px-4 rounded-xl font-medium text-sm transition-all duration-200"
        style={{
          backgroundColor: googleLoading ? "#f3f4f6" : "white",
          border: "1px solid var(--color-border)",
          color: "var(--color-ink-primary)",
          cursor: googleLoading ? "not-allowed" : "pointer",
        }}
      >
        {googleLoading ? (
          <>
            <div
              className="w-4 h-4 border-2 rounded-full animate-spin"
              style={{ borderColor: "var(--color-border)", borderTopColor: "var(--color-primary)" }}
            />
            Signing in…
          </>
        ) : (
          <>
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
            Continue with Google
          </>
        )}
      </button>
    </div>
  );
}
