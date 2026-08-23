"use client";

import { useState } from "react";
import { EXPLORER_TRANSFERS } from "@/lib/config";

/**
 * Marketing navbar for the standalone PULSE token site. Self-contained — no
 * links to, or dependency on, any other site. Brand mark is "PULSE"; the token
 * ticker (PLSX) appears in the page content, not the logo.
 *
 * "Explore Token" opens the real Solana Explorer (devnet). "Join Community"
 * jumps to the on-page community section (which honestly says links are coming
 * soon) — no fabricated social links.
 */
const LINKS = [
  ["About", "#about"],
  ["Tokenomics", "#tokenomics"],
  ["Utility", "#utility"],
  ["Roadmap", "#roadmap"],
  ["Security", "#security"],
  ["FAQ", "#faq"],
  ["Docs", "#docs"],
];

export default function Navbar() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <nav className="nav">
      <div className="container nav-inner">
        <a href="#top" className="logo" onClick={close}>
          <span className="logo-mark" aria-hidden="true" />
          <span className="wordmark">PULSE</span>
        </a>

        <div className="nav-links" style={open ? mobileOpen : undefined}>
          {LINKS.map(([label, href]) => (
            <a href={href} key={href} onClick={close}>
              {label}
            </a>
          ))}
          <span className="nav-cta">
            <a
              href={EXPLORER_TRANSFERS}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-green btn-sm"
              onClick={close}
            >
              Explore Token ↗
            </a>
            <a href="#community" className="btn btn-ghost btn-sm" onClick={close}>
              Join Community
            </a>
          </span>
        </div>

        <button className="nav-toggle" onClick={() => setOpen((v) => !v)} aria-label="Menu" aria-expanded={open}>
          ☰
        </button>
      </div>
    </nav>
  );
}

const mobileOpen = {
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  position: "absolute",
  top: "68px",
  left: 0,
  right: 0,
  background: "var(--bg-elev)",
  padding: "20px 24px",
  borderBottom: "1px solid var(--border)",
  gap: "18px",
};
