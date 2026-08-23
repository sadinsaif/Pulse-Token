"use client";

import { useState } from "react";

/**
 * Marketing navbar for the standalone $PULSE token site. Fully self-contained —
 * no links to, or dependency on, any other site. The primary CTA jumps to the
 * on-page live-balance section.
 */
export default function Navbar() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <nav className="nav">
      <div className="container nav-inner">
        <a href="#top" className="logo" onClick={close}>
          <span className="logo-mark" aria-hidden="true" />
          <span className="wordmark"><span className="wm-fy">$</span>PULSE</span>
        </a>
        <div className="nav-links" style={open ? mobileOpen : undefined}>
          <a href="#utility" onClick={close}>Utility</a>
          <a href="#how" onClick={close}>How it works</a>
          <a href="#balance" onClick={close}>Your balance</a>
          <a href="#contract" onClick={close}>Token address</a>
        </div>
        <div className="nav-cta">
          <a href="#balance" className="btn btn-primary">
            Check balance →
          </a>
        </div>
        <button className="nav-toggle" onClick={() => setOpen((v) => !v)} aria-label="Menu">
          ☰
        </button>
      </div>
    </nav>
  );
}

const mobileOpen = {
  display: "flex",
  flexDirection: "column",
  position: "absolute",
  top: "68px",
  left: 0,
  right: 0,
  background: "var(--bg-elev)",
  padding: "20px 24px",
  borderBottom: "1px solid var(--border)",
  gap: "18px",
};
