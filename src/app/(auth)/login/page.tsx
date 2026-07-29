import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { LoginButton } from "./LoginButton";

interface LoginPageProps {
  searchParams: Promise<{ error?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) redirect("/dashboard/trending");

  const params = await searchParams;

  const errorMessages: Record<string, string> = {
    auth_failed:
      "Sign-in failed. Please try again.",
    missing_code:
      "Authentication error. Please try again.",
  };

  const errorMessage = params.error ? errorMessages[params.error] : null;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4">
      {/* Logo / brand */}
      <div className="mb-8 text-center">
        <div
          className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4"
          style={{ backgroundColor: "var(--color-primary)" }}
        >
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
            <polyline points="16 7 22 7 22 13" />
          </svg>
        </div>
        <h1
          className="text-3xl font-bold tracking-tight"
          style={{ color: "var(--color-ink-primary)" }}
        >
          Forecast
        </h1>
        <p
          className="mt-1 text-sm"
          style={{ color: "var(--color-ink-secondary)" }}
        >
          Prediction Markets
        </p>
      </div>

      {/* Card */}
      <div
        className="w-full max-w-sm rounded-2xl p-8"
        style={{
          backgroundColor: "var(--color-bg-card)",
          border: "1px solid var(--color-border)",
          boxShadow: "var(--shadow-card)",
        }}
      >
        <h2
          className="text-lg font-semibold mb-1"
          style={{ color: "var(--color-ink-primary)" }}
        >
          Sign in to your account
        </h2>
        <p
          className="text-sm mb-6"
          style={{ color: "var(--color-ink-secondary)" }}
        >
          Enter your email to receive a sign-in link. No password needed.
        </p>

        {errorMessage && (
          <div
            className="rounded-lg p-3 mb-4 text-sm"
            style={{
              backgroundColor: "var(--color-no-bg)",
              color: "var(--color-danger)",
            }}
            role="alert"
          >
            {errorMessage}
          </div>
        )}

        <Suspense fallback={null}>
          <LoginButton />
        </Suspense>

        <p
          className="text-xs text-center mt-5 play-money-badge"
          style={{ color: "var(--color-ink-tertiary)" }}
        >
          Play-money prediction markets — anyone can join.
        </p>
      </div>

      {/* Play money disclaimer */}
      <p className="mt-6 text-xs play-money-badge">
        🎮 Play Money — No real currency involved
      </p>
    </div>
  );
}
