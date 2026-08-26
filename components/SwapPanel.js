"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useNetwork } from "@/components/NetworkProvider";
import WalletConnectButton from "@/components/WalletConnectButton";
import {
  connectionFor,
  getSplBalanceBaseFor,
  getSolBalanceFor,
  formatTokens,
  formatTokensPretty,
  formatLamports,
  explorerUrlFor,
} from "@/lib/solana";
import { TOKEN_SYMBOL } from "@/lib/config";
import {
  readPool,
  swapSolForTokenInstructions,
  swapTokenForSolInstructions,
  sendInstructions,
  parseAmountToBase,
  quoteSolForToken,
  quoteTokenForSol,
  applySlippage,
  plsxPerSol,
  feePercentFromBps,
} from "@/lib/swap";

const panelStyle = { maxWidth: 720, margin: "0 auto" };

const maxBtnStyle = {
  background: "none",
  border: "none",
  padding: 0,
  font: "inherit",
  color: "var(--green, #22c55e)",
  cursor: "pointer",
  textDecoration: "underline",
};

// A small fee buffer (0.01 SOL) kept aside on "Max" so a SOL→PLSX swap can still
// pay its own transaction fee.
const SOL_FEE_BUFFER = 10_000_000n; // lamports

function prettyError(e) {
  const msg = (e && (e.message || e.toString())) || "Something went wrong.";
  if (/user rejected|rejected the request|declined/i.test(msg)) return "You cancelled the transaction.";
  if (/SlippageExceeded|0x1775|custom program error: 0x1775/i.test(msg))
    return "Price moved beyond your slippage tolerance. Try again or raise slippage.";
  return msg.length > 200 ? msg.slice(0, 200) + "…" : msg;
}

/**
 * LIVE, on-chain PLSX↔SOL swap panel (devnet). A real constant-product AMM via the
 * program in lib/swap.js. Every figure — reserves, fee, the quote — is read/derived
 * straight from chain; an empty pool shows an honest "no liquidity yet", never a
 * fabricated price. The user's own wallet signs the swap; this component never
 * touches a key.
 *
 * Only ever mounted when network.features.swap is true (see DefiGrid), i.e. on a
 * network where the pool is deployed + seeded + verified.
 */
export default function SwapPanel({ network: pinned }) {
  const ctx = useNetwork();
  const network = pinned || ctx.network;
  const { publicKey, connected, sendTransaction } = useWallet();

  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [okSig, setOkSig] = useState("");

  const [pool, setPool] = useState(null);
  const [walletPlsx, setWalletPlsx] = useState(0n);
  const [walletSol, setWalletSol] = useState(0); // lamports (Number)

  const [solToToken, setSolToToken] = useState(true); // direction: SOL→PLSX
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState("1"); // percent

  useEffect(() => setMounted(true), []);

  const address = publicKey?.toBase58() || "";
  const enabled = Boolean(network.features.swap && network.mint);

  const cancelledRef = useRef(false);
  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const conn = connectionFor(network.rpc);
      const p = await readPool(conn);
      if (cancelledRef.current) return;
      setPool(p);
      if (connected && address) {
        const [plsx, sol] = await Promise.all([
          getSplBalanceBaseFor(conn, network.mint, address),
          getSolBalanceFor(conn, address),
        ]);
        if (cancelledRef.current) return;
        setWalletPlsx(plsx);
        setWalletSol(sol);
      } else {
        setWalletPlsx(0n);
        setWalletSol(0);
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

  const hasLiquidity = Boolean(pool && pool.tokenReserve > 0n && pool.solReserve > 0n);
  const slippageBps = (() => {
    const p = Number(slippage);
    if (!isFinite(p) || p < 0) return 0;
    return Math.min(10_000, Math.round(p * 100));
  })();

  // Quote from the REAL reserves (0n when input invalid / no liquidity).
  const amountBase = parseAmountToBase(amount); // SOL lamports OR PLSX base units (both 9-dec)
  const quote = !hasLiquidity || amountBase == null || amountBase <= 0n
    ? 0n
    : solToToken
      ? quoteSolForToken(pool, amountBase)
      : quoteTokenForSol(pool, amountBase);
  const minOut = applySlippage(quote, slippageBps);

  function setMax() {
    if (solToToken) {
      const spendable = BigInt(walletSol) > SOL_FEE_BUFFER ? BigInt(walletSol) - SOL_FEE_BUFFER : 0n;
      setAmount(formatTokens(spendable));
    } else {
      setAmount(formatTokens(walletPlsx));
    }
  }

  function flip() {
    setSolToToken((v) => !v);
    setAmount("");
    setError("");
    setOkSig("");
  }

  async function runSwap() {
    setError("");
    setOkSig("");
    setBusy(true);
    try {
      const conn = connectionFor(network.rpc);
      const base = parseAmountToBase(amount);
      if (base == null || base <= 0n) throw new Error("Enter a valid amount greater than 0.");
      if (!hasLiquidity) throw new Error("This pool has no liquidity yet.");

      let ixs;
      if (solToToken) {
        if (base > BigInt(walletSol)) throw new Error(`You only have ${formatLamports(walletSol)} SOL.`);
        const out = quoteSolForToken(pool, base);
        if (out <= 0n) throw new Error("Amount too small for a quote at the current reserves.");
        ixs = swapSolForTokenInstructions(publicKey, base, applySlippage(out, slippageBps));
      } else {
        if (base > walletPlsx) throw new Error(`You only have ${formatTokensPretty(walletPlsx)} ${TOKEN_SYMBOL}.`);
        const out = quoteTokenForSol(pool, base);
        if (out <= 0n) throw new Error("Amount too small for a quote at the current reserves.");
        ixs = swapTokenForSolInstructions(publicKey, base, applySlippage(out, slippageBps));
      }
      const sig = await sendInstructions({ conn, ixs, publicKey, sendTransaction });
      setOkSig(sig);
      setAmount("");
      await refresh();
    } catch (e) {
      setError(prettyError(e));
    } finally {
      setBusy(false);
    }
  }

  // ── render ────────────────────────────────────────────────────────────────
  if (!mounted) {
    return (
      <div className="panel" style={panelStyle}>
        <div className="panel-head"><h3 style={{ margin: 0 }}>Swap</h3></div>
        <p className="brief" style={{ margin: 0 }}>Loading…</p>
      </div>
    );
  }

  const fromLabel = solToToken ? "SOL" : TOKEN_SYMBOL;
  const toLabel = solToToken ? TOKEN_SYMBOL : "SOL";
  const fromBalanceStr = solToToken ? `${formatLamports(walletSol)} SOL` : `${formatTokensPretty(walletPlsx)} ${TOKEN_SYMBOL}`;
  const quoteStr = solToToken ? `${formatTokensPretty(quote)} ${TOKEN_SYMBOL}` : `${formatLamports(quote)} SOL`;
  const minOutStr = solToToken ? `${formatTokensPretty(minOut)} ${TOKEN_SYMBOL}` : `${formatLamports(minOut)} SOL`;
  const price = plsxPerSol(pool);
  // `price` is ALREADY whole PLSX-per-SOL (both legs are 9-decimal, so the reserve
  // ratio is dimensionless). Format it as a plain number — NOT through the base-unit
  // formatter, which would divide by 10^9 again and show a bogus 0.000001.
  const priceStr =
    price == null ? "—" : price.toLocaleString("en-US", { maximumFractionDigits: price >= 1 ? 2 : 6 });

  return (
    <div className="panel" style={panelStyle}>
      <div
        className="panel-head"
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}
      >
        <h3 style={{ margin: 0 }}>Swap</h3>
        <span className={`tag-pill tone-${network.tone}`}>{network.short}</span>
      </div>

      {/* Pool stats — all real on-chain values */}
      <div className="kpis" style={{ marginTop: 14, gridTemplateColumns: "repeat(3, 1fr)" }}>
        <div className="kpi">
          <div className="k-top"><span className="k-ic">🪙</span></div>
          <div className="k-val">{formatTokensPretty(pool?.tokenReserve ?? 0n)}</div>
          <div className="k-lbl">{TOKEN_SYMBOL} reserve</div>
        </div>
        <div className="kpi">
          <div className="k-top"><span className="k-ic">◎</span></div>
          <div className="k-val">{formatLamports(pool?.solReserve ?? 0n)}</div>
          <div className="k-lbl">SOL reserve</div>
        </div>
        <div className="kpi">
          <div className="k-top"><span className="k-ic">💱</span></div>
          <div className="k-val">{pool ? `${feePercentFromBps(pool.feeBps)}%` : "—"}</div>
          <div className="k-lbl">Swap fee</div>
        </div>
      </div>

      {!enabled ? (
        <p className="brief" style={{ marginTop: 14 }}>
          Swap isn&apos;t available on {network.label}.
        </p>
      ) : !pool ? (
        <p className="brief" style={{ marginTop: 14 }}>
          The swap pool isn&apos;t initialized on-chain yet. <strong>Coming Soon.</strong>
        </p>
      ) : !hasLiquidity ? (
        <p className="brief" style={{ marginTop: 14 }}>
          This pool has <strong>no liquidity yet</strong>, so there is no price to quote. Liquidity is added by the
          pool authority.
        </p>
      ) : !connected ? (
        <div style={{ textAlign: "center", padding: "18px 0 6px" }}>
          <p className="brief" style={{ marginTop: 0 }}>
            Connect your Solana wallet to swap. The current rate is{" "}
            {price ? <strong>1 SOL ≈ {priceStr} {TOKEN_SYMBOL}</strong> : "—"}.
            Every swap is signed by your own wallet — nothing is stored here.
          </p>
          <WalletConnectButton className="btn btn-green btn-lg" />
        </div>
      ) : (
        <>
          <div className="brief" style={{ marginTop: 14, fontSize: 13, color: "var(--text-mute)" }}>
            Rate: {price ? <>1 SOL ≈ {priceStr} {TOKEN_SYMBOL}</> : "—"} (from live reserves)
          </div>

          {/* From */}
          <div className="field" style={{ marginTop: 12 }}>
            <label htmlFor="swap-amount">You pay ({fromLabel})</label>
            <input
              id="swap-amount"
              inputMode="decimal"
              placeholder="0.0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={busy}
            />
          </div>
          <div className="brief" style={{ marginTop: 6, fontSize: 13, color: "var(--text-mute)" }}>
            Balance {fromBalanceStr}{" "}
            <button type="button" style={maxBtnStyle} onClick={setMax} disabled={busy}>Max</button>
          </div>

          {/* Flip direction */}
          <div style={{ marginTop: 12, display: "flex", justifyContent: "center" }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={flip} disabled={busy} aria-label="Swap direction">
              ⇅ {fromLabel} → {toLabel}
            </button>
          </div>

          {/* To (quote) */}
          <div className="field" style={{ marginTop: 8 }}>
            <label>You receive ({toLabel}, estimated)</label>
            <div
              className="k-val"
              style={{ padding: "10px 12px", border: "1px solid var(--border, #333)", borderRadius: 10, fontSize: 18 }}
            >
              ≈ {quoteStr}
            </div>
          </div>

          {/* Slippage */}
          <div className="field" style={{ marginTop: 12 }}>
            <label htmlFor="swap-slippage">Max slippage %</label>
            <input
              id="swap-slippage"
              inputMode="decimal"
              placeholder="1"
              value={slippage}
              onChange={(e) => setSlippage(e.target.value)}
              disabled={busy}
            />
          </div>
          <div className="brief" style={{ marginTop: 6, fontSize: 13, color: "var(--text-mute)" }}>
            Minimum received (reverts on-chain below this): <strong>{minOutStr}</strong>
          </div>

          <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <button className="btn btn-green" onClick={runSwap} disabled={busy || quote <= 0n}>
              {busy ? "Swapping…" : `Swap ${fromLabel} → ${toLabel}`}
            </button>
            <WalletConnectButton className="btn btn-ghost btn-sm" />
          </div>

          {okSig ? (
            <div className="alert ok" style={{ marginTop: 12 }}>
              Swap confirmed on-chain.{" "}
              <a href={explorerUrlFor(network.cluster, okSig, "tx")} target="_blank" rel="noopener noreferrer">
                View transaction ↗
              </a>
            </div>
          ) : null}
          {error ? <div className="alert err" style={{ marginTop: 12 }}>{error}</div> : null}
        </>
      )}

      <p className="brief" style={{ marginTop: 14, marginBottom: 0, color: "var(--text-mute)", fontSize: 13 }}>
        {loading ? "Reading on-chain state… " : ""}
        Devnet PLSX has no monetary value. Prices come from a constant-product pool and move with each trade;
        quotes are computed from the current on-chain reserves and the swap reverts if it would fall below your
        minimum received.
      </p>
    </div>
  );
}
