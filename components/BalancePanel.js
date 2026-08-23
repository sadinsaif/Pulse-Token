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
  TOKEN_SYMBOL,
  NETWORK,
} from "@/lib/solana";

// Rewards + claim live on the main app (one source of truth for the money).
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://pulsefycorp.vercel.app";

const NETWORK_LABEL =
  NETWORK === "mainnet-beta"
    ? "Solana Mainnet"
    : NETWORK === "devnet"
    ? "Solana Devnet"
    : `Solana ${NETWORK.charAt(0).toUpperCase()}${NETWORK.slice(1)}`;

const panelStyle = { maxWidth: 720, margin: "0 auto" };

/**
 * The one genuinely new piece of this site: connect a wallet and show its LIVE
 * on-chain $PULSE balance — a pure client-side Solana RPC read, no backend, no
 * signing, no transaction. Verifying the wallet, viewing accrued rewards, and
 * claiming all require an authenticated PulseFy account, so those are a deep-link
 * to the main app rather than duplicated here.
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
          <h3 style={{ margin: 0 }}>Your ${TOKEN_SYMBOL}</h3>
        </div>
        <p className="brief" style={{ margin: 0 }}>Loading wallet…</p>
      </div>
    );
  }

  if (!configured) {
    return (
      <div className="panel" style={panelStyle}>
        <div className="panel-head">
          <h3 style={{ margin: 0 }}>Your ${TOKEN_SYMBOL}</h3>
        </div>
        <p className="brief" style={{ margin: 0 }}>
          $PULSE isn&apos;t live yet. Once the mint is configured, connect your wallet here to
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
        <h3 style={{ margin: 0 }}>Your ${TOKEN_SYMBOL} balance</h3>
        <span className="tag-pill" style={{ color: "var(--text-mute)", fontSize: 13 }}>{NETWORK_LABEL}</span>
      </div>

      {!connected ? (
        <div style={{ textAlign: "center", padding: "18px 0" }}>
          <p className="brief" style={{ marginTop: 0 }}>
            Connect a Solana wallet to see your live on-chain $PULSE balance. It&apos;s read-only —
            connecting never moves funds or signs a transaction.
          </p>
          <WalletConnectButton className="btn btn-primary btn-lg" />
        </div>
      ) : (
        <>
          <div className="kpis" style={{ marginTop: 14 }}>
            <div className="kpi">
              <div className="k-top"><span className="k-ic">🪙</span></div>
              <div className="k-val">
                {loading ? "…" : balance != null ? formatTokensPretty(balance) : "0"}{" "}
                <span style={{ fontSize: 14, color: "var(--text-mute)" }}>${TOKEN_SYMBOL}</span>
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
            <a href={`${APP_URL}/dashboard/token`} className="btn btn-primary">
              View rewards &amp; claim →
            </a>
            <WalletConnectButton className="btn btn-ghost" />
          </div>
          <p className="brief" style={{ marginTop: 12, marginBottom: 0, color: "var(--text-mute)", fontSize: 13 }}>
            Rewards accrue and claims are paid on the main PulseFy app, where your wallet is verified to
            your account.
          </p>
        </>
      )}
    </div>
  );
}
