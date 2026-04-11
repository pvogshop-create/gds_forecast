"use client";

import { useEffect, useState } from "react";
import { Modal } from "./Modal";

const STORAGE_KEY = "gds_welcome_seen";

export function WelcomeModal() {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    // Only show once — skip if they've already dismissed it
    if (!localStorage.getItem(STORAGE_KEY)) {
      setIsOpen(true);
    }
  }, []);

  function handleDismiss() {
    localStorage.setItem(STORAGE_KEY, "1");
    setIsOpen(false);
  }

  return (
    <Modal isOpen={isOpen} onClose={handleDismiss} size="sm">
      <div className="text-center pt-2">
        <div className="text-4xl mb-4">🎯</div>

        <h2
          className="text-lg font-bold mb-2"
          style={{ color: "var(--color-ink-primary)" }}
        >
          Welcome to GDS Forecast!
        </h2>

        <p
          className="text-sm mb-3 leading-relaxed"
          style={{ color: "var(--color-ink-secondary)" }}
        >
          You start with <strong style={{ color: "var(--color-coin)" }}>1,000 coins</strong>.
          Use them to bet on what you think will happen at GDS — sports games, social events, and more.
        </p>

        <p
          className="text-sm mb-6 leading-relaxed"
          style={{ color: "var(--color-ink-tertiary)" }}
        >
          Your balance updates as markets resolve. No real money — just bragging rights.
        </p>

        <button
          onClick={handleDismiss}
          className="w-full py-2.5 rounded-xl text-sm font-semibold transition-all duration-150 hover:opacity-90 active:scale-[0.98]"
          style={{
            backgroundColor: "var(--color-primary)",
            color: "white",
          }}
        >
          Let&apos;s go →
        </button>
      </div>
    </Modal>
  );
}
