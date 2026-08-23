"use client";

import { useState } from "react";

// Where the login-bound actions (dashboard, rewards, claim) live — the main app.
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://pulsefycorp.vercel.app";

/**
 * Simplified marketing navbar for the standalone token site. Reuses the main app's
 * `.nav` markup + classes, but has NO session/sign-out state — the primary CTA
 * deep-links into the main app's $PULSE dashboard.
 */
export default function Navbar() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <nav className="nav">
      <div className="container nav-inner">
        <a href="#top" className="logo" onClick={close}>
          <span className="logo-mark" aria-hidden="true" />
          <span className="wordmark">Pulse<span className="wm-fy">Fy</span></span>
        </a>
        <div className="nav-links" style={open ? mobileOpen : undefined}>
          <a href="#utility" onClick={close}>Utility</a>
          <a href="#how" onClick={close}>How it works</a>
          <a href="#balance" onClick={close}>Your balance</a>
          <a href="#contract" onClick={close}>Token address</a>
          <a href={APP_URL} target="_blank" rel="noopener noreferrer" onClick={close}>
            Main site ↗
          </a>
        </div>
        <div className="nav-cta">
          <a href={`${APP_URL}/dashboard/token`} className="btn btn-primary">
            Open dashboard →
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
