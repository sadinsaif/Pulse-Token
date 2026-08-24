"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useNetwork } from "@/components/NetworkProvider";
import {
  connectionFor,
  getSplBalanceBaseFor,
  formatTokens,
  formatTokensPretty,
  explorerUrlFor,
} from "@/lib/solana";
import { TOKEN_SYMBOL, POOL_AUTHORITY } from "@/lib/config";
import {
  readPool,
  readRewardVaultBalance,
  initializePoolInstructions,
  fundRewardsInstructions,
  setRewardRateInstructions,
  sendInstructions,
  parseAmountToBase,
  aprPercentFromRate,
  rateFromAprPercent,
} from "@/lib/staking";

const panelStyle = { maxWidth: 720, margin: "0 auto" };

function prettyError(e) {
  const msg = (e && (e.message || e.toString())) || "Something went wrong.";
  if (/user rejected|rejected the request|declined/i.test(msg)) return "You cancelled the transaction.";
  return msg.length > 200 ? msg.slice(0, 200) + "…" : msg;
}

/**
 * Authority-only staking admin: initialize the pool, fund the reward vault, and
 * set the reward rate. It renders for NO ONE except the exact POOL_AUTHORITY
 * wallet (a public address in config — never a secret). Every action is a plain
 * transaction signed by that wallet; there is no embedded key. Funding moves the
 * authority's own PLSX into the reward vault.
 */
export default function StakeAdmin({ network: pinned }) {
  const ctx = useNetwork();
  const network = pinned || ctx.network;
  const { publicKey, connected, sendTransaction } = useWallet();

  const [mounted, setMounted] = useState(false);
  const [busy, setBusy] = useState(null); // "init" | "fund" | "rate" | null
  const [error, setError] = useState("");
  const [okSig, setOkSig] = useState("");

  const [pool, setPool] = useState(null);
  const [rewardVaultBal, setRewardVaultBal] = useState(0n);
  const [authBal, setAuthBal] = useState(0n);

  const [aprInput, setAprInput] = useState("10");
  const [fundInput, setFundInput] = useState("");

  useEffect(() => setMounted(true), []);

  const address = publicKey?.toBase58() || "";
  const isAuthority = mounted && connected && address === POOL_AUTHORITY;
  // Gate on the presence of the PLSX mint (devnet), NOT the public features.stake
  // flag — the authority must be able to initialize + fund before that flag flips.
  const enabled = Boolean(network.mint);

  const cancelledRef = useRef(false);
  const refresh = useCallback(async () => {
    if (!enabled || !isAuthority) return;
    try {
      const conn = connectionFor(network.rpc);
      const [p, rv, ab] = await Promise.all([
        readPool(conn),
        readRewardVaultBalance(conn),
        getSplBalanceBaseFor(conn, network.mint, address),
      ]);
      if (cancelledRef.current) return;
      setPool(p);
      setRewardVaultBal(rv);
      setAuthBal(ab);
    } catch {
      /* best-effort reads */
    }
  }, [enabled, isAuthority, network.rpc, network.mint, address]);

  useEffect(() => {
    cancelledRef.current = false;
    refresh();
    return () => {
      cancelledRef.current = true;
    };
  }, [refresh]);

  async function runAction(kind) {
    setError("");
    setOkSig("");
    setBusy(kind);
    try {
      const conn = connectionFor(network.rpc);
      let ixs;
      if (kind === "init") {
        const rate = rateFromAprPercent(aprInput);
        if (rate == null) throw new Error("Enter a valid APR percentage (e.g. 10).");
        ixs = initializePoolInstructions(publicKey, rate);
      } else if (kind === "rate") {
        const rate = rateFromAprPercent(aprInput);
        if (rate == null) throw new Error("Enter a valid APR percentage.");
        ixs = setRewardRateInstructions(publicKey, rate);
      } else {
        const base = parseAmountToBase(fundInput);
        if (base == null || base <= 0n) throw new Error("Enter a valid amount to fund.");
        if (base > authBal) throw new Error(`Your wallet holds ${formatTokensPretty(authBal)} ${TOKEN_SYMBOL}.`);
        ixs = fundRewardsInstructions(publicKey, base);
      }
      const sig = await sendInstructions({ conn, ixs, publicKey, sendTransaction });
      setOkSig(sig);
      if (kind === "fund") setFundInput("");
      await refresh();
    } catch (e) {
      setError(prettyError(e));
    } finally {
      setBusy(null);
    }
  }

  // Invisible to everyone but the authority wallet, and only where PLSX exists.
  if (!isAuthority || !enabled) return null;

  const initialized = Boolean(pool);
  const rewardRate = pool?.rewardRate ?? 0n;
  const anyBusy = busy != null;
  const targetRate = rateFromAprPercent(aprInput);

  return (
    <div className="panel" style={{ ...panelStyle, borderColor: "var(--green, #22c55e)", marginBottom: 24 }}>
      <div
        className="panel-head"
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}
      >
        <h3 style={{ margin: 0 }}>Staking Admin</h3>
        <span className={`tag-pill tone-${network.tone}`}>Authority</span>
      </div>

      <p className="brief" style={{ marginTop: 8 }}>
        You are connected as the pool authority. These actions are signed by <strong>your</strong> wallet
        (no key is stored anywhere). Pool state:{" "}
        <strong>{initialized ? "Initialized" : "Not initialized"}</strong>
        {initialized ? <> · rate ≈ {aprPercentFromRate(rewardRate).toFixed(1)}% APR · reward vault {formatTokensPretty(rewardVaultBal)} {TOKEN_SYMBOL}</> : null}.
      </p>

      {/* Reward rate (used for both initialize and set-rate) */}
      <div className="field" style={{ marginTop: 12 }}>
        <label htmlFor="admin-apr">Target APR %</label>
        <input
          id="admin-apr"
          inputMode="decimal"
          placeholder="10"
          value={aprInput}
          onChange={(e) => setAprInput(e.target.value)}
          disabled={anyBusy}
        />
      </div>
      <div className="brief" style={{ marginTop: 6, fontSize: 13, color: "var(--text-mute)" }}>
        On-chain reward_rate = {targetRate != null ? targetRate.toString() : "—"} (0 pauses rewards).
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        {!initialized ? (
          <button className="btn btn-green" onClick={() => runAction("init")} disabled={anyBusy}>
            {busy === "init" ? "Initializing…" : "Initialize pool"}
          </button>
        ) : (
          <button className="btn btn-ghost" onClick={() => runAction("rate")} disabled={anyBusy}>
            {busy === "rate" ? "Updating…" : "Set reward rate"}
          </button>
        )}
      </div>

      {/* Fund rewards */}
      <div className="field" style={{ marginTop: 16 }}>
        <label htmlFor="admin-fund">Fund reward vault ({TOKEN_SYMBOL})</label>
        <input
          id="admin-fund"
          inputMode="decimal"
          placeholder="0.0"
          value={fundInput}
          onChange={(e) => setFundInput(e.target.value)}
          disabled={anyBusy || !initialized}
        />
      </div>
      <div className="brief" style={{ marginTop: 6, fontSize: 13, color: "var(--text-mute)" }}>
        Your wallet {formatTokensPretty(authBal)} {TOKEN_SYMBOL}{" "}
        <button
          type="button"
          style={{ background: "none", border: "none", padding: 0, font: "inherit", color: "var(--green, #22c55e)", cursor: "pointer", textDecoration: "underline" }}
          onClick={() => setFundInput(formatTokens(authBal))}
          disabled={anyBusy || !initialized}
        >
          Max
        </button>
      </div>
      <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button className="btn btn-green" onClick={() => runAction("fund")} disabled={anyBusy || !initialized}>
          {busy === "fund" ? "Funding…" : "Fund rewards"}
        </button>
      </div>

      {okSig ? (
        <div className="alert ok" style={{ marginTop: 12 }}>
          Confirmed on-chain.{" "}
          <a href={explorerUrlFor(network.cluster, okSig, "tx")} target="_blank" rel="noopener noreferrer">
            View transaction ↗
          </a>
        </div>
      ) : null}
      {error ? <div className="alert err" style={{ marginTop: 12 }}>{error}</div> : null}
    </div>
  );
}
