"use client";

import { useEffect } from "react";

// Catches errors in the root layout and any layout-level crashes that
// page-level error boundaries cannot reach.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global] Layout error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily: "system-ui, sans-serif",
          backgroundColor: "#FAFAFC",
          color: "#14121C",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
        }}
      >
        <div
          style={{
            textAlign: "center",
            padding: "40px 24px",
            maxWidth: "400px",
          }}
        >
          <p style={{ fontSize: "32px", marginBottom: "12px" }}>⚠️</p>
          <p
            style={{
              fontWeight: 600,
              fontSize: "15px",
              marginBottom: "8px",
            }}
          >
            Something went wrong.
          </p>
          <p
            style={{
              fontSize: "13px",
              color: "#5A5568",
              marginBottom: "20px",
            }}
          >
            An unexpected error occurred. Please try again.
          </p>
          <button
            onClick={reset}
            style={{
              padding: "8px 20px",
              borderRadius: "8px",
              border: "none",
              backgroundColor: "#7C3AED",
              color: "white",
              fontSize: "13px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
