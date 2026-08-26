"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useNetwork } from "@/components/NetworkProvider";
import WalletConnectButton from "@/components/WalletConnectButton";
import {
  connectionFor,
  getSplBalanceBaseFor,
  formatTokens,
  formatTokensPretty,
  explorerUrlFor,
} from "@/lib/solana";
import { TOKEN_SYMBOL } from "@/lib/config";
import {
  readPool,
  readUserStake,
  readStakeVaultBalance,
  readRewardVaultBalance,
  stakeInstructions,
  unstakeInstructions,
  claimInstructions,
  sendInstructions,
  parseAmountToBase,
  aprPercentFromRate,
  estimateClaimable,
} from "@/lib/staking";

const panelStyle = { maxWidth: 560, margin: "0 auto" };

// The real PULSE token mark shipped at public/token/logo.png (the same mark the
// navbar uses) — no invented glyph. Staking has a single asset, so the pill is
// static (nothing to flip to).
const PLSX_MARK = <img src="/token/logo.png" alt="" width={26} height={26} />;

// A short, human-friendly message from a thrown wallet/RPC error.
function prettyError(e) {
  const msg = (e && (e.message || e.toString())) || "Something went wrong.";
  if (/user rejected|rejected the request|declined/i.test(msg)) return "You cancelled the transaction.";
  return msg.length > 200 ? msg.slice(0, 200) + "…" : msg;
}

/**
 * LIVE, on-chain PLSX staking panel (devnet). Stake PLSX → earn PLSX from an
 * authority-funded reward vault, via the REAL program in lib/staking.js. Every
 * figure shown is read straight from chain; the only estimate (live "earned" and
 * APR) is computed with the SAME formula the on-chain program settles with, and
 * is labelled as an estimate. The user's own wallet signs every action — this
 * component never touches a key.
 *
 * Only ever mounted when network.features.stake is true (see DefiGrid), i.e. on a
 * network where the pool is deployed + funded + verified.
 *
 * The layout matches the swap dashboard's Across-style look (big amount card, a
 * PLSX pill, a full-width primary CTA + secondary actions); the visuals live in
 * the `.swapx-*` / `.stakex-*` blocks of globals.css. All logic below the render
 * boundary is unchanged — reserves, APR, "earned", and the signed actions all
 * come straight from the real on-chain state.
 */
export default function StakePanel({ network: pinned }) {
  const ctx = useNetwork();
  const network = pinned || ctx.network;
  const { publicKey, connected, sendTransaction } = useWallet();

  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(null); // "stake" | "unstake" | "claim" | null
  const [error, setError] = useState("");
  const [okSig, setOkSig] = useState("");

  const [pool, setPool] = useState(null);
  const [user, setUser] = useState(null);
  const [walletBal, setWalletBal] = useState(0n);
  const [stakeVaultBal, setStakeVaultBal] = useState(0n);
  const [rewardVaultBal, setRewardVaultBal] = useState(0n);

  const [amount, setAmount] = useState("");
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => setMounted(true), []);

  // Live clock for the "earned" estimate (pure client math over real on-chain state).
  useEffect(() => {
    const t = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  const address = publicKey?.toBase58() || "";
  const enabled = Boolean(network.features.stake && network.mint);

  const cancelledRef = useRef(false);
  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const conn = connectionFor(network.rpc);
      const [p, sv, rv] = await Promise.all([
        readPool(conn),
        readStakeVaultBalance(conn),
        readRewardVaultBalance(conn),
      ]);
      if (cancelledRef.current) return;
      setPool(p);
      setStakeVaultBal(sv);
      setRewardVaultBal(rv);
      if (connected && address) {
        const [u, wb] = await Promise.all([
          readUserStake(conn, address),
          getSplBalanceBaseFor(conn, network.mint, address),
        ]);
        if (cancelledRef.current) return;
        setUser(u);
        setWalletBal(wb);
      } else {
        setUser(null);
        setWalletBal(0n);
      }
    } catch {
      /* reads are best-effort; UI shows whatever loaded. */
    } finally {
      if (!cancelledRef.current) setLoading(false);
    }
  }, [enabled, network.rpc, network.mint, connected, address]);

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
      if (kind === "claim") {
        ixs = claimInstructions(publicKey);
      } else {
        const base = parseAmountToBase(amount);
        if (base == null || base <= 0n) throw new Error("Enter a valid amount greater than 0.");
        if (kind === "stake") {
          if (base > walletBal) throw new Error(`You only have ${formatTokensPretty(walletBal)} ${TOKEN_SYMBOL} in your wallet.`);
          ixs = await stakeInstructions(conn, publicKey, base);
        } else {
          const staked = user?.amount ?? 0n;
          if (base > staked) throw new Error(`You only have ${formatTokensPretty(staked)} ${TOKEN_SYMBOL} staked.`);
          ixs = unstakeInstructions(publicKey, base);
        }
      }
      const sig = await sendInstructions({ conn, ixs, publicKey, sendTransaction });
      setOkSig(sig);
      setAmount("");
      await refresh();
    } catch (e) {
      setError(prettyError(e));
    } finally {
      setBusy(null);
    }
  }

  // ── render ────────────────────────────────────────────────────────────────
  if (!mounted) {
    return (
      <div className="panel swapx-panel stakex-panel" style={panelStyle}>
        <div className="panel-head swapx-head"><h3 style={{ margin: 0 }}>Stake {TOKEN_SYMBOL}</h3></div>
        <p className="brief" style={{ margin: 0 }}>Loading…</p>
      </div>
    );
  }

  const staked = user?.amount ?? 0n;
  const rewardRate = pool?.rewardRate ?? 0n;
  const apr = aprPercentFromRate(rewardRate);
  const earned = estimateClaimable(user, rewardRate, nowSec);
  const anyBusy = busy != null;

  return (
    <div className="panel swapx-panel stakex-panel" style={panelStyle}>
      <div className="panel-head swapx-head">
        <h3 style={{ margin: 0 }}>Stake {TOKEN_SYMBOL}</h3>
        <span className={`tag-pill tone-${network.tone}`}>{network.short}</span>
      </div>

      {!enabled ? (
        <p className="brief" style={{ marginTop: 14 }}>
          Staking isn&apos;t available on {network.label}.
        </p>
      ) : !pool ? (
        <p className="brief" style={{ marginTop: 14 }}>
          The staking pool isn&apos;t initialized on-chain yet. <strong>Coming Soon.</strong>
        </p>
      ) : (
        <>
          {/* Pool stats — all real on-chain values */}
          <div className="stakex-stats">
            <div className="stakex-stat">
              <span className="stakex-stat-lbl">Total staked</span>
              <span className="stakex-stat-val">
                {formatTokensPretty(pool?.totalStaked ?? 0n)}<i>{TOKEN_SYMBOL}</i>
              </span>
            </div>
            <div className="stakex-stat">
              <span className="stakex-stat-lbl">Reward vault</span>
              <span className="stakex-stat-val">
                {formatTokensPretty(rewardVaultBal)}<i>{TOKEN_SYMBOL}</i>
              </span>
            </div>
            <div className="stakex-stat">
              <span className="stakex-stat-lbl">{rewardRate > 0n ? "Est. APR (on-chain rate)" : "Est. APR (0 rate)"}</span>
              <span className={`stakex-stat-val${rewardRate > 0n ? " accent" : ""}`}>
                {rewardRate > 0n ? `≈ ${apr.toFixed(1)}%` : "Paused"}
              </span>
            </div>
          </div>

          {!connected ? (
            <>
              <p className="brief" style={{ marginTop: 16, textAlign: "center" }}>
                Connect your Solana wallet to stake {TOKEN_SYMBOL}. Every stake, unstake, and claim is signed by
                your own wallet — nothing is stored here.
              </p>
              <WalletConnectButton className="btn btn-green btn-block btn-lg swapx-cta" />
            </>
          ) : (
            <>
              {/* Amount card (Across-style) */}
              <div className="swapx-form">
                <div className="swapx-card">
                  <div className="swapx-card-top">
                    <span className="swapx-card-label">Amount</span>
                    <span className="swapx-bal">
                      Wallet: {formatTokensPretty(walletBal)} {TOKEN_SYMBOL}
                      <button
                        type="button"
                        className="swapx-max"
                        onClick={() => setAmount(formatTokens(walletBal))}
                        disabled={anyBusy}
                      >
                        Max
                      </button>
                    </span>
                  </div>
                  <div className="swapx-card-row">
                    <input
                      id="stake-amount"
                      className="swapx-amount"
                      inputMode="decimal"
                      placeholder="0.0"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      disabled={anyBusy}
                      aria-label={`Amount in ${TOKEN_SYMBOL}`}
                    />
                    <span className="swapx-asset swapx-asset-static" title={TOKEN_SYMBOL}>
                      <span className="swapx-ic swapx-ic-plsx" aria-hidden>{PLSX_MARK}</span>
                      <span className="swapx-asset-meta">
                        <b>{TOKEN_SYMBOL}</b>
                        <small>{network.label}</small>
                      </span>
                    </span>
                  </div>
                </div>
              </div>

              {/* Your position */}
              <div className="swapx-info">
                <div className="swapx-info-row">
                  <span>Your stake</span>
                  <b>
                    {formatTokensPretty(staked)} {TOKEN_SYMBOL}
                    <button
                      type="button"
                      className="swapx-max"
                      style={{ marginLeft: 8 }}
                      onClick={() => setAmount(formatTokens(staked))}
                      disabled={anyBusy}
                    >
                      Max
                    </button>
                  </b>
                </div>
                <div className="swapx-info-row">
                  <span>Earned (live est.)</span>
                  <b>{formatTokensPretty(earned)} {TOKEN_SYMBOL}</b>
                </div>
              </div>

              {/* Actions — primary Stake + secondary Unstake / Claim */}
              <button
                className="btn btn-green btn-block btn-lg swapx-cta"
                onClick={() => runAction("stake")}
                disabled={anyBusy}
              >
                {busy === "stake" ? "Staking…" : `Stake ${TOKEN_SYMBOL}`}
              </button>
              <div className="stakex-actions">
                <button className="btn btn-ghost btn-block" onClick={() => runAction("unstake")} disabled={anyBusy}>
                  {busy === "unstake" ? "Unstaking…" : "Unstake"}
                </button>
                <button
                  className="btn btn-ghost btn-block"
                  onClick={() => runAction("claim")}
                  disabled={anyBusy || earned <= 0n}
                >
                  {busy === "claim" ? "Claiming…" : "Claim rewards"}
                </button>
              </div>
              <div className="stakex-wallet">
                <WalletConnectButton className="btn btn-ghost btn-sm" />
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
            </>
          )}

          {/* Live status — the pool really exists on-chain here. */}
          <div className="swapx-pool">
            <span className="swapx-pool-dot" aria-hidden /> Live on {network.label} · rewards{" "}
            {rewardRate > 0n ? "active" : "paused"}
          </div>
        </>
      )}

      <p className="brief swapx-note">
        {loading ? "Reading on-chain state… " : ""}
        Devnet PLSX has no monetary value. Rewards are paid from the reward vault while it is funded;
        a claim pays out what the vault can cover. Figures are read live from Solana; the “earned”
        and APR values are estimates from the current on-chain reward rate.
      </p>
    </div>
  );
}
