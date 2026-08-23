"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useNetwork } from "@/components/NetworkProvider";
import WalletConnectButton from "@/components/WalletConnectButton";
import {
  connectionFor,
  requestAirdropFor,
  explorerUrlFor,
  LAMPORTS_PER_SOL,
} from "@/lib/solana";

// Real, keyless test-SOL faucet.
//
// "Request Test SOL" calls connection.requestAirdrop — a genuine on-chain
// airdrop funded by the cluster, needing NO private key and NO wallet signature.
// It exists only on devnet/testnet and the public faucet is heavily rate-limited,
// so we (a) enforce our own 1-request-per-wallet-per-24h guard in localStorage,
// and (b) on failure show the REAL error + a link to the official web faucet —
// never a fake "success".
//
// PLSX faucet stays "Coming Soon": there is no controlled testnet mint authority,
// and a mint-authority secret must NEVER live in frontend code.
const REQUEST_LAMPORTS = 1 * LAMPORTS_PER_SOL; // 1 SOL (public faucets cap low)
const COOLDOWN_MS = 24 * 60 * 60 * 1000;

export default function TestSolFaucet({ network: pinned, onFunded }) {
  const ctx = useNetwork();
  const network = pinned || ctx.network;
  const { publicKey, connected } = useWallet();
  const [mounted, setMounted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // { ok, sig?, msg }
  const [cooldownUntil, setCooldownUntil] = useState(0);

  useEffect(() => setMounted(true), []);

  const address = publicKey?.toBase58() || "";
  const guardKey = address ? `pulse.faucet.${network.cluster}.${address}` : "";

  // Read any existing cooldown for this wallet+cluster.
  useEffect(() => {
    setResult(null);
    if (!guardKey) {
      setCooldownUntil(0);
      return;
    }
    try {
      const last = Number(window.localStorage.getItem(guardKey) || 0);
      setCooldownUntil(last ? last + COOLDOWN_MS : 0);
    } catch {
      setCooldownUntil(0);
    }
  }, [guardKey]);

  const now = mounted ? Date.now() : 0;
  const onCooldown = cooldownUntil > now;
  const hoursLeft = onCooldown ? Math.ceil((cooldownUntil - now) / (60 * 60 * 1000)) : 0;

  async function requestSol() {
    if (!connected || !address || busy || onCooldown) return;
    setBusy(true);
    setResult(null);
    try {
      const conn = connectionFor(network.rpc);
      const sig = await requestAirdropFor(conn, address, REQUEST_LAMPORTS);
      try {
        window.localStorage.setItem(guardKey, String(Date.now()));
      } catch {
        /* ignore */
      }
      setCooldownUntil(Date.now() + COOLDOWN_MS);
      setResult({ ok: true, sig, msg: "Airdrop confirmed. Your test SOL balance will update shortly." });
      if (typeof onFunded === "function") onFunded();
    } catch (e) {
      // Surface the REAL error — public faucets frequently rate-limit or refuse.
      const raw = e?.message || String(e);
      setResult({
        ok: false,
        msg: raw.includes("429") || /rate|limit|faucet/i.test(raw)
          ? "The public faucet is rate-limited right now. Try again later or use the official web faucet below."
          : `Airdrop failed: ${raw}`,
      });
    } finally {
      setBusy(false);
    }
  }

  const available = network.features.faucetSol;

  return (
    <div className="panel faucet-panel">
      <div className="panel-head">
        <h3 style={{ margin: 0 }}>Faucet</h3>
        <span className={`tag-pill tone-${network.tone}`}>{network.short}</span>
      </div>

      {/* Test SOL — REAL requestAirdrop */}
      <div className="faucet-row">
        <div className="faucet-info">
          <strong>Test SOL</strong>
          <p className="brief">
            Get {network.label} test SOL to pay transaction fees. Public faucet — may be rate-limited.
            Test SOL has no monetary value.
          </p>
        </div>
        <div className="faucet-action">
          {!mounted ? null : !connected ? (
            <WalletConnectButton className="btn btn-green btn-sm" />
          ) : !available ? (
            <span className="soon-badge">Unavailable</span>
          ) : (
            <button
              type="button"
              className="btn btn-green btn-sm"
              onClick={requestSol}
              disabled={busy || onCooldown}
            >
              {busy ? "Requesting…" : onCooldown ? `Try again in ${hoursLeft}h` : "Request Test SOL"}
            </button>
          )}
        </div>
      </div>

      {result ? (
        <div className={`alert ${result.ok ? "ok" : "err"}`} style={{ marginTop: 6 }}>
          {result.msg}
          {result.ok && result.sig ? (
            <>
              {" "}
              <a
                href={explorerUrlFor(network.cluster, result.sig, "tx")}
                target="_blank"
                rel="noopener noreferrer"
              >
                View transaction ↗
              </a>
            </>
          ) : null}
          {!result.ok ? (
            <>
              {" "}
              <a href="https://faucet.solana.com" target="_blank" rel="noopener noreferrer">
                Official web faucet ↗
              </a>
            </>
          ) : null}
        </div>
      ) : null}

      {/* PLSX faucet — honestly Coming Soon */}
      <div className="faucet-row faucet-row-soon">
        <div className="faucet-info">
          <strong>PLSX (test)</strong>
          <p className="brief">
            A rate-limited PLSX test faucet will arrive once a controlled Testnet mint exists. Token minting
            is never exposed in the browser.
          </p>
        </div>
        <div className="faucet-action">
          <span className="soon-badge">Coming Soon</span>
        </div>
      </div>
    </div>
  );
}
