"use client";

import { useState } from "react";

/**
 * A click-to-copy address chip for public pages. Deliberately takes only plain
 * string props (the value + optional short label) so the landing page can render
 * it WITHOUT pulling @solana/web3.js into the client bundle — the server computes
 * the address string and passes it down. Mirrors the `.addr-copy` styling used by
 * the admin claims table.
 */
export default function CopyAddress({ value, label, className = "" }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    if (!value) return;
    navigator.clipboard?.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  }

  return (
    <button type="button" className={`addr-copy ${className}`.trim()} onClick={copy} title="Click to copy">
      <span className="addr-text" style={{ wordBreak: "break-all" }}>{label || value}</span>
      <span className="addr-ic">{copied ? "✓ copied" : "⧉"}</span>
    </button>
  );
}
