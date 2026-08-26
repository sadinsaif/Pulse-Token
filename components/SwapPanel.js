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

const panelStyle = { maxWidth: 560, margin: "0 auto" };

// A small fee buffer (0.01 SOL) kept aside on "Max" so a SOL→PLSX swap can still
// pay its own transaction fee.
const SOL_FEE_BUFFER = 10_000_000n; // lamports

// Real brand marks — no invented glyphs. SOL = the official Solana logomark
// (inline SVG, purple→green, no network fetch); PLSX = the actual PULSE token
// logo shipped at public/token/logo.png (the same mark the navbar uses).
const SOL_MARK = (
  <svg viewBox="0 0 397.7 311.7" role="img" aria-label="Solana">
    <defs>
      <linearGradient id="swapxSolGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#9945FF" />
        <stop offset="100%" stopColor="#14F195" />
      </linearGradient>
    </defs>
    <path fill="url(#swapxSolGrad)" d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7z" />
    <path fill="url(#swapxSolGrad)" d="M64.6 3.8C67.1 1.4 70.4 0 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8z" />
    <path fill="url(#swapxSolGrad)" d="M333.1 120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1l-62.7-62.7z" />
  </svg>
);
const PLSX_MARK = <img src="/token/logo.png" alt="" width={26} height={26} />;

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
 *
 * The layout is an Across-style two-card swapper (From / flip / To + a big CTA);
 * the visuals live in the `.swapx-*` block of globals.css. All logic below the
 * render boundary is unchanged — quotes, slippage→min_out, and the signed swap
 * still come straight from the real on-chain reserves.
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
      <div className="panel swapx-panel" style={panelStyle}>
        <div className="panel-head"><h3 style={{ margin: 0 }}>Swap</h3></div>
        <p className="brief" style={{ margin: 0 }}>Loading…</p>
      </div>
    );
  }

  const fromLabel = solToToken ? "SOL" : TOKEN_SYMBOL;
  const toLabel = solToToken ? TOKEN_SYMBOL : "SOL";
  const fromKey = solToToken ? "SOL" : "PLSX";
  const toKey = solToToken ? "PLSX" : "SOL";

  const fromBalanceStr = solToToken ? `${formatLamports(walletSol)} SOL` : `${formatTokensPretty(walletPlsx)} ${TOKEN_SYMBOL}`;
  const toBalanceStr = solToToken ? `${formatTokensPretty(walletPlsx)} ${TOKEN_SYMBOL}` : `${formatLamports(walletSol)} SOL`;

  // Numbers only — the asset symbol lives in the pill beside each amount.
  const quoteNum = quote > 0n ? (solToToken ? formatTokensPretty(quote) : formatLamports(quote)) : "0.0";
  const minOutStr = solToToken ? `${formatTokensPretty(minOut)} ${TOKEN_SYMBOL}` : `${formatLamports(minOut)} SOL`;

  const price = plsxPerSol(pool);
  // `price` is ALREADY whole PLSX-per-SOL (both legs are 9-decimal, so the reserve
  // ratio is dimensionless). Format it as a plain number — NOT through the base-unit
  // formatter, which would divide by 10^9 again and show a bogus 0.000001.
  const priceStr =
    price == null ? "—" : price.toLocaleString("en-US", { maximumFractionDigits: price >= 1 ? 2 : 6 });

  const ctaLabel = busy
    ? "Swapping…"
    : !amount || amount.trim() === ""
      ? "Enter an amount"
      : quote <= 0n
        ? "Amount too small"
        : `Swap ${fromLabel} → ${toLabel}`;

  // A token "pill" (icon + symbol + network). Clicking it flips the direction —
  // with only two real assets, that's the whole picker.
  const pill = (assetKey, symbol) => (
    <button
      type="button"
      className="swapx-asset"
      onClick={flip}
      disabled={busy}
      title="Switch direction"
      aria-label={`${symbol} — switch direction`}
    >
      <span className={`swapx-ic swapx-ic-${assetKey === "SOL" ? "sol" : "plsx"}`} aria-hidden>
        {assetKey === "SOL" ? SOL_MARK : PLSX_MARK}
      </span>
      <span className="swapx-asset-meta">
        <b>{symbol}</b>
        <small>{network.label}</small>
      </span>
    </button>
  );

  return (
    <div className="panel swapx-panel" style={panelStyle}>
      <div className="panel-head swapx-head">
        <h3 style={{ margin: 0 }}>Swap</h3>
        <span className={`tag-pill tone-${network.tone}`}>{network.short}</span>
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
      ) : (
        <>
          <div className="swapx-form">
            {/* FROM */}
            <div className="swapx-card">
              <div className="swapx-card-top">
                <span className="swapx-card-label">You pay</span>
                <span className="swapx-bal">
                  Balance: {connected ? fromBalanceStr : "—"}
                  {connected ? (
                    <button type="button" className="swapx-max" onClick={setMax} disabled={busy}>Max</button>
                  ) : null}
                </span>
              </div>
              <div className="swapx-card-row">
                <input
                  className="swapx-amount"
                  inputMode="decimal"
                  placeholder="0.0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  disabled={busy}
                  aria-label={`Amount to pay in ${fromLabel}`}
                />
                {pill(fromKey, fromLabel)}
              </div>
            </div>

            {/* FLIP */}
            <div className="swapx-flip-row">
              <button
                type="button"
                className="swapx-flip"
                onClick={flip}
                disabled={busy}
                aria-label="Switch direction"
              >
                ↓
              </button>
            </div>

            {/* TO (estimated) */}
            <div className="swapx-card swapx-card-to">
              <div className="swapx-card-top">
                <span className="swapx-card-label">You receive (estimated)</span>
                <span className="swapx-bal">Balance: {connected ? toBalanceStr : "—"}</span>
              </div>
              <div className="swapx-card-row">
                <div className={`swapx-amount swapx-amount-out${quote > 0n ? "" : " is-zero"}`}>
                  {quote > 0n ? "≈ " : ""}{quoteNum}
                </div>
                {pill(toKey, toLabel)}
              </div>
            </div>
          </div>

          {/* Rate / slippage / min received */}
          <div className="swapx-info">
            <div className="swapx-info-row">
              <span>Rate</span>
              <b>{price ? <>1 SOL ≈ {priceStr} {TOKEN_SYMBOL}</> : "—"}</b>
            </div>
            <div className="swapx-info-row">
              <span>Max slippage</span>
              <span className="swapx-slip">
                <input
                  className="swapx-slip-input"
                  inputMode="decimal"
                  placeholder="1"
                  value={slippage}
                  onChange={(e) => setSlippage(e.target.value)}
                  disabled={busy}
                  aria-label="Max slippage percent"
                />
                <span className="swapx-slip-pct">%</span>
              </span>
            </div>
            <div className="swapx-info-row">
              <span>Minimum received</span>
              <b>{minOutStr}</b>
            </div>
          </div>

          {/* CTA — swap when connected, otherwise connect first (form stays visible). */}
          {connected ? (
            <button
              className="btn btn-green btn-block btn-lg swapx-cta"
              onClick={runSwap}
              disabled={busy || quote <= 0n}
            >
              {ctaLabel}
            </button>
          ) : (
            <WalletConnectButton className="btn btn-green btn-block btn-lg swapx-cta" />
          )}

          {okSig ? (
            <div className="alert ok" style={{ marginTop: 12 }}>
              Swap confirmed on-chain.{" "}
              <a href={explorerUrlFor(network.cluster, okSig, "tx")} target="_blank" rel="noopener noreferrer">
                View transaction ↗
              </a>
            </div>
          ) : null}
          {error ? <div className="alert err" style={{ marginTop: 12 }}>{error}</div> : null}

          {/* Live pool — real on-chain reserves, straight from state. */}
          <div className="swapx-pool">
            <span className="swapx-pool-dot" aria-hidden /> Live pool ·{" "}
            <b>{formatTokensPretty(pool?.tokenReserve ?? 0n)}</b> {TOKEN_SYMBOL} ·{" "}
            <b>{formatLamports(pool?.solReserve ?? 0n)}</b> SOL ·{" "}
            {pool ? `${feePercentFromBps(pool.feeBps)}%` : "—"} fee
          </div>
        </>
      )}

      <p className="brief swapx-note">
        {loading ? "Reading on-chain state… " : ""}
        Devnet PLSX has no monetary value. Prices come from a constant-product pool and move with each trade;
        quotes are computed from the current on-chain reserves and the swap reverts if it would fall below your
        minimum received.
      </p>
    </div>
  );
}
