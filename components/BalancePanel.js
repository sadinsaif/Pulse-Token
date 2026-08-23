"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import WalletConnectButton from "@/components/WalletConnectButton";
import {
  getSplBalanceBase,
  formatTokensPretty,
  isTokenConfigured,
  explorerUrl,
  shortAddress,
} from "@/lib/solana";
import { TOKEN_SYMBOL, NETWORK_LABEL } from "@/lib/config";

const panelStyle = { maxWidth: 720, margin: "0 auto" };

/**
 * The live dApp core: connect a Solana wallet and show its LIVE on-chain PLSX
 * balance — a pure client-side RPC read. Nothing is stored, no backend is
 * called, and connecting never signs a transaction or moves any funds.
 */
export default function BalancePanel() {
  const { publicKey, connected } = useWallet();
  const [mounted, setMounted] = useState(false);
  const [balance, setBalance] = useState(null); // BigInt base units | null
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => setMounted(true), []);

  const address = publicKey?.toBase58() || "";
  const configured = isTokenConfigured();

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!connected || !address || !configured) {
        setBalance(null);
        return;
      }
      setLoading(true);
      setError("");
      try {
        const b = await getSplBalanceBase(address);
        if (!cancelled) setBalance(b);
      } catch {
        if (!cancelled) setError("Couldn't read your on-chain balance. Please try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [connected, address, configured]);

  // Stable placeholder before mount → no hydration mismatch from wallet state.
  if (!mounted) {
    return (
      <div className="panel" style={panelStyle}>
        <div className="panel-head">
          <h3 style={{ margin: 0 }}>Your {TOKEN_SYMBOL} Balance</h3>
        </div>
        <p className="brief" style={{ margin: 0 }}>Loading wallet…</p>
      </div>
    );
  }

  if (!configured) {
    return (
      <div className="panel" style={panelStyle}>
        <div className="panel-head">
          <h3 style={{ margin: 0 }}>Your {TOKEN_SYMBOL} Balance</h3>
        </div>
        <p className="brief" style={{ margin: 0 }}>
          {TOKEN_SYMBOL} isn&apos;t live yet. Once the mint is configured, connect your wallet here to
          see your live on-chain balance.
        </p>
      </div>
    );
  }

  return (
    <div className="panel" style={panelStyle}>
      <div
        className="panel-head"
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}
      >
        <h3 style={{ margin: 0 }}>Your {TOKEN_SYMBOL} Balance</h3>
        <span className="tag-pill" style={{ color: "var(--text-mute)", fontSize: 13 }}>{NETWORK_LABEL}</span>
      </div>

      {!connected ? (
        <div style={{ textAlign: "center", padding: "18px 0" }}>
          <p className="brief" style={{ marginTop: 0 }}>
            Connect a Solana wallet to see your live on-chain {TOKEN_SYMBOL} balance. It&apos;s read-only —
            connecting never moves funds or signs a transaction.
          </p>
          <WalletConnectButton className="btn btn-green btn-lg" />
        </div>
      ) : (
        <>
          <div className="kpis" style={{ marginTop: 14, gridTemplateColumns: "repeat(2, 1fr)" }}>
            <div className="kpi">
              <div className="k-top"><span className="k-ic">🪙</span></div>
              <div className="k-val">
                {loading ? "…" : balance != null ? formatTokensPretty(balance) : "0"}{" "}
                <span style={{ fontSize: 14, color: "var(--text-mute)" }}>{TOKEN_SYMBOL}</span>
              </div>
              <div className="k-lbl">On-chain balance</div>
            </div>
            <div className="kpi">
              <div className="k-top"><span className="k-ic">👛</span></div>
              <div className="k-val" style={{ fontSize: 16 }}>{shortAddress(address, 4, 4)}</div>
              <div className="k-lbl">
                <a href={explorerUrl(address, "address")} target="_blank" rel="noopener noreferrer">
                  View on Explorer ↗
                </a>
              </div>
            </div>
          </div>

          {error ? <div className="alert err" style={{ marginTop: 12 }}>{error}</div> : null}

          <div style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <WalletConnectButton className="btn btn-ghost" />
          </div>
          <p className="brief" style={{ marginTop: 12, marginBottom: 0, color: "var(--text-mute)", fontSize: 13 }}>
            Your balance is read live from the Solana blockchain. Nothing is stored here and no
            transaction is signed.
          </p>
        </>
      )}
    </div>
  );
}
