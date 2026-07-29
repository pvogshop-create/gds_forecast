"use client";

import { useEffect, useState } from "react";
import { X, CheckCircle, AlertCircle, Info } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastType = "success" | "error" | "info";

interface ToastData {
  id: string;
  type: ToastType;
  message: string;
}

// Simple singleton toast store
let listeners: ((toasts: ToastData[]) => void)[] = [];
let toasts: ToastData[] = [];

function notify(toastData: ToastData) {
  toasts = [...toasts, toastData];
  listeners.forEach((l) => l(toasts));

  // Auto-dismiss after 4 seconds
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== toastData.id);
    listeners.forEach((l) => l(toasts));
  }, 4000);
}

// Public API to show toasts from anywhere
export const toast = {
  success: (message: string) =>
    notify({ id: crypto.randomUUID(), type: "success", message }),
  error: (message: string) =>
    notify({ id: crypto.randomUUID(), type: "error", message }),
  info: (message: string) =>
    notify({ id: crypto.randomUUID(), type: "info", message }),
};

// Toast container — render once in AppShell or layout
export function ToastContainer() {
  const [currentToasts, setCurrentToasts] = useState<ToastData[]>(toasts);

  useEffect(() => {
    listeners.push(setCurrentToasts);
    return () => {
      listeners = listeners.filter((l) => l !== setCurrentToasts);
    };
  }, []);

  if (currentToasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-24 lg:bottom-6 right-4 z-50 flex flex-col gap-2"
      aria-live="polite"
      aria-label="Notifications"
    >
      {currentToasts.map((t) => (
        <ToastItem
          key={t.id}
          toast={t}
          onDismiss={() => {
            toasts = toasts.filter((x) => x.id !== t.id);
            listeners.forEach((l) => l(toasts));
          }}
        />
      ))}
    </div>
  );
}

interface ToastItemProps {
  toast: ToastData;
  onDismiss: () => void;
}

function ToastItem({ toast: t, onDismiss }: ToastItemProps) {
  // success/error keep their semantic green and red; "info" is brand voice, not an
  // outcome, so it takes the purple accent rather than the old blue.
  const icons = {
    success: (
      <CheckCircle size={16} className="text-[var(--color-success)]" />
    ),
    error: <AlertCircle size={16} className="text-[var(--color-danger)]" />,
    info: <Info size={16} className="text-[var(--color-primary)]" />,
  };

  const bgColors = {
    success: "bg-white border-[var(--color-success)]/30",
    error: "bg-white border-[var(--color-danger)]/30",
    info: "bg-white border-[var(--color-primary)]/30",
  };

  return (
    <div
      className={cn(
        "flex items-start gap-3 px-4 py-3 rounded-xl shadow-lg border min-w-64 max-w-sm",
        bgColors[t.type]
      )}
      role="alert"
      style={{ animation: "toast-in 0.2s ease" }}
    >
      <span className="mt-0.5 flex-shrink-0">{icons[t.type]}</span>
      <p
        className="text-sm flex-1"
        style={{ color: "var(--color-ink-primary)" }}
      >
        {t.message}
      </p>
      <button
        onClick={onDismiss}
        className="flex-shrink-0 opacity-50 hover:opacity-100 transition-opacity"
        aria-label="Dismiss notification"
      >
        <X size={14} />
      </button>

      <style>{`
        @keyframes toast-in {
          from { opacity: 0; transform: translateX(16px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}
