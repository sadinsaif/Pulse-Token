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

// Self-service test-SOL faucet.
//
// PRIMARY path: POST /api/faucet, a server route that transfers test SOL from a
// USER-FUNDED treasury wallet straight to the connected wallet. This does NOT
// depend on the flaky public faucet, so it works whenever the treasury has a
// balance. The treasury secret lives only on the server (never in this file).
//
// FALLBACK path: if the treasury isn't configured for this cluster yet
// (reason "not-configured" / "wrong-cluster"), we fall back to the keyless
// public airdrop (connection.requestAirdrop) — today's behavior — so nothing
// breaks before the treasury is set up. On any failure we show the REAL error
// and a link to the official web faucet; we never fake a success.
//
// Either way the claim is rate-limited to 1 / wallet / 24h. The server is the
// real enforcer; this localStorage guard is a first-line UX convenience.
//
// PLSX faucet stays "Coming Soon": there is no controlled testnet mint authority,
// and a mint-authority secret must NEVER live in frontend code.
const REQUEST_LAMPORTS = 1 * LAMPORTS_PER_SOL; // fallback public-faucet request size
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

  // Persist a cooldown so `msFromNow` from now shows as "try again" (survives
  // refresh). The reader effect above computes cooldownUntil = stored + 24h, so
  // we store the value that makes that arithmetic land on the target instant.
  function persistCooldown(msFromNow) {
    const until = Date.now() + msFromNow;
    try {
      window.localStorage.setItem(guardKey, String(until - COOLDOWN_MS));
    } catch {
      /* ignore */
    }
    setCooldownUntil(until);
  }

  // Keyless public-faucet fallback (the original behavior).
  async function keylessFallback() {
    try {
      const conn = connectionFor(network.rpc);
      const sig = await requestAirdropFor(conn, address, REQUEST_LAMPORTS);
      persistCooldown(COOLDOWN_MS);
      setResult({
        ok: true,
        sig,
        msg: "Airdrop confirmed (public faucet). Your test SOL balance will update shortly.",
      });
      if (typeof onFunded === "function") onFunded();
    } catch (e) {
      const raw = e?.message || String(e);
      setResult({
        ok: false,
        msg:
          raw.includes("429") || /rate|limit|faucet/i.test(raw)
            ? "The public faucet is rate-limited right now. Try again later or use the official web faucet below."
            : `Airdrop failed: ${raw}`,
      });
    }
  }

  async function requestSol() {
    if (!connected || !address || busy || onCooldown) return;
    setBusy(true);
    setResult(null);
    try {
      // 1) Try the treasury faucet first.
      let data;
      try {
        const res = await fetch("/api/faucet", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address, cluster: network.cluster }),
        });
        data = await res.json();
      } catch {
        data = { ok: false, reason: "network" };
      }

      const sig = data?.signature || data?.sig;
      if (data?.ok && sig) {
        persistCooldown(COOLDOWN_MS);
        const amt = data.amountSol != null ? `${data.amountSol} ` : "";
        setResult({
          ok: true,
          sig,
          msg: `Sent ${amt}test SOL from the treasury. Your balance will update shortly.`,
        });
        if (typeof onFunded === "function") onFunded();
        return;
      }

      // 2) Treasury can't serve this claim (not set up for this cluster, wrong
      //    cluster, or momentarily empty) → best-effort keyless public airdrop,
      //    then the always-present official-faucet link if that's throttled too.
      if (
        data?.reason === "not-configured" ||
        data?.reason === "wrong-cluster" ||
        data?.reason === "empty"
      ) {
        await keylessFallback();
        return;
      }

      // 3) Server-enforced cooldown — reflect it in the client guard too.
      if (data?.reason === "cooldown") {
        const ms = Number(data.retryAfterMs) || COOLDOWN_MS;
        persistCooldown(ms);
        const hrs = Math.ceil(ms / (60 * 60 * 1000));
        setResult({ ok: false, msg: `You've already claimed recently. Try again in ${hrs}h.` });
        return;
      }

      // 4) Anything else (tx-failed / bad-address / network) → honest error.
      setResult({
        ok: false,
        msg: data?.message
          ? `Faucet error: ${data.message}`
          : "The faucet couldn't complete your request. Please try the official web faucet below.",
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

      {/* Test SOL — treasury transfer, with keyless public-faucet fallback */}
      <div className="faucet-row">
        <div className="faucet-info">
          <strong>Test SOL</strong>
          <p className="brief">
            Get {network.label} test SOL to pay transaction fees. One claim per wallet per 24h.
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

      {/* Always-available official faucet link — a real, working alternate
          source of test SOL that works even when the treasury is empty or the
          public RPC airdrop is throttled. Routes to Solana's own faucet; nothing
          is faked here, we just point users at a genuine faucet. */}
      {available ? (
        <p className="brief" style={{ marginTop: 8 }}>
          You can also claim {network.label} test SOL from the{" "}
          <a href="https://faucet.solana.com" target="_blank" rel="noopener noreferrer">
            official Solana faucet ↗
          </a>{" "}
          — pick <strong>{network.label}</strong> there and paste your wallet address.
        </p>
      ) : null}

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
