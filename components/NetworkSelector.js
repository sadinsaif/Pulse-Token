"use client";

import { useEffect, useRef, useState } from "react";
import { useNetwork } from "@/components/NetworkProvider";
import { NETWORK_ORDER, NETWORKS, SELECTABLE } from "@/config/networks";

// Professional network selector: shows all three networks with an honest status
// dot. Devnet (Active) and Testnet (Beta) are selectable; Mainnet (Coming Soon)
// is rendered but disabled — it can never be activated. Selection persists via
// NetworkProvider (localStorage).
export default function NetworkSelector() {
  const { networkId, network, setNetworkId } = useNetwork();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const choose = (id) => {
    if (setNetworkId(id)) setOpen(false);
  };

  return (
    <div className="netsel" ref={ref}>
      <button
        type="button"
        className="netsel-btn"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Select Solana network"
      >
        <span className={`netsel-dot tone-${network.tone}`} aria-hidden="true" />
        <span className="netsel-cur">{network.short}</span>
        <span className="netsel-caret" aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <ul className="netsel-menu" role="listbox" aria-label="Solana network">
          {NETWORK_ORDER.map((id) => {
            const n = NETWORKS[id];
            const selectable = SELECTABLE.includes(id);
            const active = id === networkId;
            return (
              <li key={id} role="option" aria-selected={active} aria-disabled={!selectable}>
                <button
                  type="button"
                  className={`netsel-item ${active ? "is-current" : ""} ${
                    selectable ? "" : "is-disabled"
                  }`}
                  onClick={() => selectable && choose(id)}
                  disabled={!selectable}
                >
                  <span className={`netsel-dot tone-${n.tone}`} aria-hidden="true" />
                  <span className="netsel-name">{n.short}</span>
                  <span className={`netsel-tag tone-${n.tone}`}>{n.statusLabel}</span>
                  {active && (
                    <span className="netsel-check" aria-hidden="true">
                      ✓
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
