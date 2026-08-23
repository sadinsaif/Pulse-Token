"use client";

import { useEffect, useState } from "react";
import CopyAddress from "@/components/CopyAddress";
import { useNetwork } from "@/components/NetworkProvider";
import {
  connectionFor,
  getMintStatusFor,
  formatTokensPretty,
  explorerUrlFor,
  shortAddress,
} from "@/lib/solana";
import { TOKEN_SYMBOL } from "@/lib/config";

/**
 * Security & Transparency — shows ONLY what we can verify live on-chain.
 * Reads the selected network's mint account (supply, decimals, mint/freeze
 * authority) via getMintStatusFor(). No fabricated audit badges or green
 * "verified" checks: authorities are reported exactly as they are (Active vs
 * Revoked), and third-party verification is honestly "Not yet verified".
 *
 * NETWORK-AWARE: networks without a deployed PLSX mint (Testnet/Mainnet) show an
 * honest notice instead of a link to a non-existent address.
 *
 * Props:
 *   network  optional config to pin to (defaults to the global selection).
 */
export default function SecurityStatus({ network: pinned }) {
  const ctx = useNetwork();
  const network = pinned || ctx.network;
  const mint = network.mint;
  const canRead = Boolean(network.features.security && mint);

  const [status, setStatus] = useState(null); // mint status | null
  const [state, setState] = useState("loading"); // loading | ok | error

  useEffect(() => {
    if (!canRead) return undefined;
    let cancelled = false;
    setState("loading");
    setStatus(null);
    (async () => {
      try {
        const s = await getMintStatusFor(connectionFor(network.rpc), mint);
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
  }, [canRead, network.rpc, mint]);

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

  // No mint on this network → honest notice, no fake rows, no dead links.
  if (!canRead) {
    return (
      <div className="panel sec-panel" style={{ maxWidth: 820, margin: "0 auto" }}>
        <div className="sec-row">
          <span className="sec-label">Network</span>
          <span className="sec-value">{network.label}</span>
        </div>
        <div className="sec-row">
          <span className="sec-label">On-chain status</span>
          <span className="sec-value sec-muted">
            No {TOKEN_SYMBOL} token is deployed on {network.label} yet — nothing to inspect here.
            Security details are available on Solana Devnet, where {TOKEN_SYMBOL} is live.
          </span>
        </div>
        <p className="sec-foot">
          We never show a mint address or authority status for a token that doesn&apos;t exist.
        </p>
      </div>
    );
  }

  return (
    <div className="panel sec-panel" style={{ maxWidth: 820, margin: "0 auto" }}>
      <div className="sec-grid">
        {/* Mint address — known from config, copyable + explorer */}
        <div className="sec-row">
          <span className="sec-label">Mint Address</span>
          <span className="sec-value sec-addr">
            <CopyAddress value={mint} />
            <a href={explorerUrlFor(network.cluster, mint, "address")} target="_blank" rel="noopener noreferrer" className="sec-link">
              Explorer ↗
            </a>
          </span>
        </div>

        {/* Network */}
        <div className="sec-row">
          <span className="sec-label">Network</span>
          <span className="sec-value">{network.label}</span>
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
              <a href={explorerUrlFor(network.cluster, mint, "address")} target="_blank" rel="noopener noreferrer" className="sec-link">
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
            <a href={explorerUrlFor(network.cluster, mint, "address")} target="_blank" rel="noopener noreferrer" className="sec-link">
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
