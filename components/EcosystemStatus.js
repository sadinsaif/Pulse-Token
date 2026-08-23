"use client";

import { useNetwork } from "@/components/NetworkProvider";
import { NETWORK_ORDER, NETWORKS } from "@/config/networks";

// Honest ecosystem status strip: shows all three networks with their real
// status (🟢 Devnet Active / 🔵 Testnet Beta / ⚪ Mainnet Coming Soon) and
// highlights the one currently selected. The selected network's disclaimer is
// shown below — no monetary-value claims, no fake dates.
export default function EcosystemStatus() {
  const { networkId, network } = useNetwork();

  return (
    <div className="eco-status">
      <div className="eco-status-row">
        {NETWORK_ORDER.map((id) => {
          const n = NETWORKS[id];
          const active = id === networkId;
          return (
            <div key={id} className={`eco-net tone-${n.tone} ${active ? "is-current" : ""}`}>
              <span className={`eco-net-dot tone-${n.tone}`} aria-hidden="true" />
              <span className="eco-net-name">{n.short}</span>
              <span className="eco-net-status">{n.statusLabel}</span>
            </div>
          );
        })}
      </div>
      <p className="eco-status-note">{network.disclaimer}</p>
    </div>
  );
}
