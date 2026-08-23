"use client";

import { NETWORK_LABEL, IS_MAINNET_LIVE } from "@/lib/config";

/**
 * Small honest network-status badge. Purely driven by config: as long as
 * MAINNET_MINT_ADDRESS is null (IS_MAINNET_LIVE === false), it says the token is
 * live on Devnet for testing and Mainnet is not launched. No countdowns, no
 * fake dates. When a real mainnet mint is set one day, it flips automatically.
 */
export default function NetworkStatus() {
  return (
    <div className="netstat" role="status" aria-live="polite">
      <span className={`netstat-dot ${IS_MAINNET_LIVE ? "is-live" : "is-test"}`} aria-hidden="true" />
      <div className="netstat-body">
        <strong>{IS_MAINNET_LIVE ? "Live on Solana Mainnet" : `Live on ${NETWORK_LABEL}`}</strong>
        <span>
          {IS_MAINNET_LIVE
            ? "PLSX is deployed on Solana Mainnet."
            : "PLSX runs on Devnet for testing — no monetary value. Mainnet is not launched yet."}
        </span>
      </div>
      <span className={`netstat-badge ${IS_MAINNET_LIVE ? "is-live" : "is-test"}`}>
        {IS_MAINNET_LIVE ? "MAINNET" : "DEVNET"}
      </span>
    </div>
  );
}
