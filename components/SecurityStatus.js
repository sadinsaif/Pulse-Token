"use client";

import { useEffect, useState } from "react";
import CopyAddress from "@/components/CopyAddress";
import {
  getMintStatus,
  formatTokensPretty,
  explorerUrl,
  shortAddress,
  TOKEN_MINT,
} from "@/lib/solana";
import { TOKEN_SYMBOL, NETWORK_LABEL } from "@/lib/config";

/**
 * Security & Transparency — shows ONLY what we can verify live on-chain.
 * Reads the mint account (supply, decimals, mint/freeze authority) via
 * getMintStatus(). No fabricated audit badges or green "verified" checks:
 * authorities are reported exactly as they are (Active vs Revoked), and
 * third-party verification is honestly labelled "Not yet verified".
 */
export default function SecurityStatus() {
  const [status, setStatus] = useState(null); // mint status | null
  const [state, setState] = useState("loading"); // loading | ok | error

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await getMintStatus();
        if (cancelled) return;
        if (!s) {
          setState("error");
          return;
        }
        setStatus(s);
        setState("ok");
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const authRow = (auth) =>
    auth ? (
      <span className="sec-pill is-active" title={auth}>
        <span className="sec-dot" /> Active · {shortAddress(auth, 4, 4)}
      </span>
    ) : (
      <span className="sec-pill is-revoked">
        <span className="sec-dot" /> Revoked
      </span>
    );

  return (
    <div className="panel sec-panel" style={{ maxWidth: 820, margin: "0 auto" }}>
      <div className="sec-grid">
        {/* Mint address — always known from config, copyable + explorer */}
        <div className="sec-row">
          <span className="sec-label">Mint Address</span>
          <span className="sec-value sec-addr">
            <CopyAddress value={TOKEN_MINT} />
            <a href={explorerUrl(TOKEN_MINT, "address")} target="_blank" rel="noopener noreferrer" className="sec-link">
              Explorer ↗
            </a>
          </span>
        </div>

        {/* Network */}
        <div className="sec-row">
          <span className="sec-label">Network</span>
          <span className="sec-value">{NETWORK_LABEL}</span>
        </div>

        {/* Live-read rows */}
        {state === "loading" && (
          <div className="sec-row">
            <span className="sec-label">On-chain status</span>
            <span className="sec-value sec-muted">Reading live from Solana…</span>
          </div>
        )}

        {state === "error" && (
          <div className="sec-row">
            <span className="sec-label">On-chain status</span>
            <span className="sec-value sec-muted">
              Couldn&apos;t read the mint right now. Verify directly on{" "}
              <a href={explorerUrl(TOKEN_MINT, "address")} target="_blank" rel="noopener noreferrer" className="sec-link">
                Solana Explorer ↗
              </a>
            </span>
          </div>
        )}

        {state === "ok" && status && (
          <>
            <div className="sec-row">
              <span className="sec-label">Total Supply</span>
              <span className="sec-value">
                {status.supply != null ? formatTokensPretty(status.supply, status.decimals) : "—"}{" "}
                <em className="sec-sym">{TOKEN_SYMBOL}</em>
              </span>
            </div>
            <div className="sec-row">
              <span className="sec-label">Decimals</span>
              <span className="sec-value">{status.decimals}</span>
            </div>
            <div className="sec-row">
              <span className="sec-label">Mint Authority</span>
              <span className="sec-value">{authRow(status.mintAuthority)}</span>
            </div>
            <div className="sec-row">
              <span className="sec-label">Freeze Authority</span>
              <span className="sec-value">{authRow(status.freezeAuthority)}</span>
            </div>
          </>
        )}

        {/* Static, honest rows */}
        <div className="sec-row">
          <span className="sec-label">Metadata</span>
          <span className="sec-value">
            On-chain (Metaplex) ·{" "}
            <a href={explorerUrl(TOKEN_MINT, "address")} target="_blank" rel="noopener noreferrer" className="sec-link">
              Explorer ↗
            </a>
          </span>
        </div>
        <div className="sec-row">
          <span className="sec-label">Third-party Audit</span>
          <span className="sec-value sec-muted">Not yet verified</span>
        </div>
      </div>

      <p className="sec-foot">
        All values above are read directly from the Solana blockchain — verify them yourself on Explorer.
        &ldquo;Active&rdquo; means the authority still exists; nothing here is a security guarantee.
      </p>
    </div>
  );
}
