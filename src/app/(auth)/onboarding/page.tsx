import { requireAuth, getProfile } from "@/lib/auth";
import { redirect } from "next/navigation";
import { OnboardingForm } from "./OnboardingForm";

export default async function OnboardingPage() {
  const user = await requireAuth();
  const profile = await getProfile(user.id);

  // If onboarding already completed, go to app
  if (profile?.username) {
    redirect("/dashboard/trending");
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4">
      {/* Logo */}
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
          Welcome to GDS Forecast
        </h1>
        <p
          className="mt-1 text-sm"
          style={{ color: "var(--color-ink-secondary)" }}
        >
          Let&apos;s set up your account
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
        {/* Coins welcome */}
        <div
          className="flex items-center gap-3 rounded-xl p-4 mb-6"
          style={{ backgroundColor: "var(--color-primary-light)" }}
        >
          <span className="text-2xl">🪙</span>
          <div>
            <p
              className="text-sm font-semibold"
              style={{ color: "var(--color-primary)" }}
            >
              1,000 coins credited!
            </p>
            <p
              className="text-xs"
              style={{ color: "var(--color-ink-secondary)" }}
            >
              Your starting balance for prediction markets
            </p>
          </div>
        </div>

        <OnboardingForm userId={user.id} displayName={profile?.display_name ?? null} />
      </div>

      <p className="mt-6 text-xs play-money-badge">
        🎮 Play Money — No real currency involved
      </p>
    </div>
  );
}
