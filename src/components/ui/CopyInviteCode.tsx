"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";

interface CopyInviteCodeProps {
  code: string;
}

export function CopyInviteCode({ code }: CopyInviteCodeProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-all duration-150"
      style={{
        backgroundColor: copied
          ? "var(--color-yes-bg)"
          : "var(--color-primary-light)",
        color: copied ? "var(--color-yes)" : "var(--color-primary)",
      }}
      aria-label={copied ? "Copied!" : "Copy invite code"}
    >
      {copied ? (
        <>
          <Check size={12} strokeWidth={2.5} />
          Copied!
        </>
      ) : (
        <>
          <Copy size={12} strokeWidth={2} />
          Copy
        </>
      )}
    </button>
  );
}
