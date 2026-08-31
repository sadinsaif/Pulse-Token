"use client";

import { useState } from "react";
import SolBalance from "@/components/SolBalance";
import TestSolFaucet from "@/components/TestSolFaucet";

// Native-SOL balance + the self-service test-SOL faucet, side by side, on the
// ecosystem page. BOTH follow the globally-selected network (Devnet or Testnet),
// so a brand-new user with an empty wallet can claim test SOL for whichever
// network they're on — the fee currency they need before any swap or stake.
//
// This is the small client island the (server-rendered) ecosystem page needs:
// a successful faucet claim bumps `solRefresh`, which re-reads the balance card
// right away instead of waiting for the next wallet/network change.
export default function SolAssets() {
  const [solRefresh, setSolRefresh] = useState(0);

  return (
    <div className="tn-grid">
      <div className="panel" style={{ margin: 0 }}>
        <div className="panel-head">
          <h3 style={{ margin: 0 }}>Native SOL</h3>
        </div>
        <div className="kpis" style={{ gridTemplateColumns: "1fr" }}>
          <SolBalance refreshSignal={solRefresh} />
        </div>
        <p
          className="brief"
          style={{ marginTop: 10, marginBottom: 0, color: "var(--text-mute)", fontSize: 13 }}
        >
          SOL pays Solana transaction fees. On Devnet/Testnet it&apos;s free test SOL with no value —
          claim some from the faucet to cover fees before you swap or stake on Devnet.
        </p>
      </div>

      <TestSolFaucet onFunded={() => setSolRefresh((n) => n + 1)} />
    </div>
  );
}
