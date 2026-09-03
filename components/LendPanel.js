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
  readMarket,
  readPosition,
  readVaultBalance,
  readOraclePool,
  depositCollateralInstructions,
  borrowInstructions,
  repayInstructions,
  withdrawCollateralInstructions,
  sendInstructions,
  parseAmountToBase,
  plsxPerSol,
  pctFromBps,
  collateralValuePlsx,
  borrowLimitPlsx,
  availableToBorrow,
  currentDebt,
  healthFactor,
} from "@/lib/lend";

const panelStyle = { maxWidth: 640, margin: "0 auto" };
const linkBtnStyle = {
  background: "none",
  border: "none",
  padding: 0,
  font: "inherit",
  color: "var(--green, #22c55e)",
  cursor: "pointer",
  textDecoration: "underline",
};
// Keep 0.01 SOL aside on "Max" deposit so the tx can still pay its own fee.
const SOL_FEE_BUFFER = 10_000_000n; // lamports

function prettyError(e) {
  const msg = (e && (e.message || e.toString())) || "Something went wrong.";
  if (/user rejected|rejected the request|declined/i.test(msg)) return "You cancelled the transaction.";
  if (/ExceedsLtv|0x1776/i.test(msg)) return "This would exceed your borrow limit (LTV). Borrow less, or add more collateral.";
  if (/InsufficientPool|0x1774/i.test(msg)) return `The lending pool doesn't have enough ${TOKEN_SYMBOL} right now.`;
  if (/InsufficientCollateral|0x1775/i.test(msg)) return "You don't have that much collateral deposited.";
  if (/NoLiquidity|0x177a/i.test(msg)) return "The price oracle (swap pool) has no liquidity yet, so borrowing is unavailable.";
  if (/Paused|0x177c/i.test(msg)) return "Borrowing is paused by the operator right now.";
  if (/NothingToRepay|0x1777/i.test(msg)) return "You have no outstanding debt to repay.";
  return msg.length > 200 ? msg.slice(0, 200) + "…" : msg;
}

function healthTone(h) {
  if (h == null) return "var(--text-mute)";
  if (h >= 1.5) return "#22c55e";
  if (h >= 1.15) return "#f59e0b";
  return "#ef4444";
}

/**
 * LIVE, on-chain lend/borrow panel (devnet): deposit native SOL as collateral, borrow
 * PLSX against it, repay, and withdraw. Backed by the real money-market program in
 * lib/lend.js, priced by our own swap pool. Every figure — collateral, debt (with live
 * accrued interest), borrow limit, health, oracle price, pool liquidity — is read/
 * derived straight from chain. An uninitialized market or an empty pool shows an honest
 * message, never a fabricated number. The user's own wallet signs every action; this
 * component never touches a key.
 *
 * Only ever mounted when network.features.lend is true (see DefiGrid), i.e. where the
 * market is deployed + seeded + verified.
 */
export default function LendPanel({ network: pinned }) {
  const ctx = useNetwork();
  const network = pinned || ctx.network;
  const { publicKey, connected, sendTransaction } = useWallet();

  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(null); // "deposit" | "borrow" | "repay" | "withdraw" | null
  const [error, setError] = useState("");
  const [okSig, setOkSig] = useState("");

  const [market, setMarket] = useState(null);
  const [position, setPosition] = useState(null);
  const [vaultBal, setVaultBal] = useState(0n);
  const [oracle, setOracle] = useState(null);
  const [walletPlsx, setWalletPlsx] = useState(0n);
  const [walletSol, setWalletSol] = useState(0); // lamports (Number)

  const [depositAmt, setDepositAmt] = useState("");
  const [borrowAmt, setBorrowAmt] = useState("");
  const [repayAmt, setRepayAmt] = useState("");
  const [withdrawAmt, setWithdrawAmt] = useState("");

  useEffect(() => setMounted(true), []);

  const address = publicKey?.toBase58() || "";
  const enabled = Boolean(network.features?.lend && network.mint);

  const cancelledRef = useRef(false);
  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const conn = connectionFor(network.rpc);
      const [m, v, o] = await Promise.all([readMarket(conn), readVaultBalance(conn), readOraclePool(conn)]);
      if (cancelledRef.current) return;
      setMarket(m);
      setVaultBal(v);
      setOracle(o);
      if (connected && address) {
        const [pos, plsx, sol] = await Promise.all([
          readPosition(conn, address),
          getSplBalanceBaseFor(conn, network.mint, address),
          getSolBalanceFor(conn, address),
        ]);
        if (cancelledRef.current) return;
        setPosition(pos);
        setWalletPlsx(plsx);
        setWalletSol(sol);
      } else {
        setPosition(null);
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

  async function runAction(kind) {
    setError("");
    setOkSig("");
    setBusy(kind);
    try {
      const conn = connectionFor(network.rpc);
      let ixs;
      if (kind === "deposit") {
        const lamports = parseAmountToBase(depositAmt);
        if (lamports == null || lamports <= 0n) throw new Error("Enter a valid SOL amount.");
        if (lamports > BigInt(walletSol)) throw new Error(`You only have ${formatLamports(walletSol)} SOL.`);
        // First-ever interaction: open the position PDA in the same tx.
        ixs = depositCollateralInstructions(publicKey, lamports, { needsOpen: !position });
      } else if (kind === "borrow") {
        const amt = parseAmountToBase(borrowAmt);
        if (amt == null || amt <= 0n) throw new Error(`Enter a valid ${TOKEN_SYMBOL} amount.`);
        if (!position || position.collateralLamports <= 0n) throw new Error("Deposit SOL collateral first.");
        if (amt > vaultBal) throw new Error(`The lending pool only has ${formatTokensPretty(vaultBal)} ${TOKEN_SYMBOL}.`);
        ixs = borrowInstructions(publicKey, amt);
      } else if (kind === "repay") {
        const amt = parseAmountToBase(repayAmt);
        if (amt == null || amt <= 0n) throw new Error(`Enter a valid ${TOKEN_SYMBOL} amount.`);
        if (amt > walletPlsx) throw new Error(`You only have ${formatTokensPretty(walletPlsx)} ${TOKEN_SYMBOL}.`);
        ixs = repayInstructions(publicKey, amt);
      } else {
        // withdraw collateral
        const lamports = parseAmountToBase(withdrawAmt);
        if (lamports == null || lamports <= 0n) throw new Error("Enter a valid SOL amount.");
        if (!position || lamports > position.collateralLamports)
          throw new Error(`You only have ${formatLamports(Number(position?.collateralLamports ?? 0n))} SOL as collateral.`);
        ixs = withdrawCollateralInstructions(publicKey, lamports);
      }
      const sig = await sendInstructions({ conn, ixs, publicKey, sendTransaction });
      setOkSig(sig);
      if (kind === "deposit") setDepositAmt("");
      if (kind === "borrow") setBorrowAmt("");
      if (kind === "repay") setRepayAmt("");
      if (kind === "withdraw") setWithdrawAmt("");
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
      <div className="panel" style={panelStyle}>
        <div className="panel-head"><h3 style={{ margin: 0 }}>Lend / Borrow</h3></div>
        <p className="brief" style={{ margin: 0 }}>Loading…</p>
      </div>
    );
  }

  const oracleHasLiquidity = Boolean(oracle && oracle.tokenReserve > 0n && oracle.solReserve > 0n);
  const price = plsxPerSol(oracle);
  const priceStr = price == null ? "—" : price.toLocaleString("en-US", { maximumFractionDigits: price >= 1 ? 2 : 6 });

  // Derived, live position figures — computed with the EXACT on-chain integer math.
  const collateralLamports = position?.collateralLamports ?? 0n;
  const collateralValue = collateralValuePlsx(collateralLamports, oracle); // PLSX base units
  const debt = currentDebt(position, market?.borrowAprBps || 0); // PLSX base units, incl. accrued interest
  const limit = borrowLimitPlsx(collateralValue, market?.ltvBps || 0);
  const availByLtv = availableToBorrow(collateralValue, market?.ltvBps || 0, debt);
  const availToBorrow = availByLtv < vaultBal ? availByLtv : vaultBal; // capped by pool liquidity
  const health = healthFactor(collateralValue, market?.liqThresholdBps || 0, debt);
  const hasDebt = debt > 0n;
  const anyBusy = busy != null;

  const setDepositMax = () => {
    const spendable = BigInt(walletSol) > SOL_FEE_BUFFER ? BigInt(walletSol) - SOL_FEE_BUFFER : 0n;
    setDepositAmt(formatTokens(spendable));
  };
  const setBorrowMax = () => setBorrowAmt(formatTokens(availToBorrow));
  const setRepayMax = () => setRepayAmt(formatTokens(debt < walletPlsx ? debt : walletPlsx));
  // A withdraw "Max" is only safe to auto-fill when there is no debt (otherwise the LTV
  // check governs how much can leave, and we won't guess a number that might revert).
  const setWithdrawMax = () => setWithdrawAmt(formatTokens(collateralLamports));

  return (
    <div className="panel" style={panelStyle}>
      <div className="panel-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0 }}>Lend / Borrow</h3>
        <span className={`tag-pill tone-${network.tone}`}>{network.short}</span>
      </div>

      {!enabled ? (
        <p className="brief" style={{ marginTop: 14 }}>Lending isn&apos;t available on {network.label}.</p>
      ) : !market ? (
        <p className="brief" style={{ marginTop: 14 }}>
          The lending market isn&apos;t initialized on-chain yet. <strong>Coming Soon.</strong>
        </p>
      ) : (
        <>
          {/* Market facts — all read from chain. */}
          <div className="brief" style={{ marginTop: 12, fontSize: 14 }}>
            Deposit <strong>SOL</strong> as collateral and borrow <strong>{TOKEN_SYMBOL}</strong> against it.
            {" "}Borrow APR <strong>{pctFromBps(market.borrowAprBps)}%</strong> · max LTV{" "}
            <strong>{pctFromBps(market.ltvBps)}%</strong> · liquidation at{" "}
            <strong>{pctFromBps(market.liqThresholdBps)}%</strong>.
            {market.paused ? <> · <strong style={{ color: "#f59e0b" }}>Borrowing paused</strong></> : null}
          </div>

          <div className="lend-stats" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
            <div className="lend-stat">
              <span className="brief" style={{ fontSize: 12, color: "var(--text-mute)" }}>Oracle price</span>
              <div><strong>{oracleHasLiquidity ? <>1 SOL ≈ {priceStr} {TOKEN_SYMBOL}</> : "No oracle liquidity"}</strong></div>
            </div>
            <div className="lend-stat">
              <span className="brief" style={{ fontSize: 12, color: "var(--text-mute)" }}>Pool available</span>
              <div><strong>{formatTokensPretty(vaultBal)} {TOKEN_SYMBOL}</strong></div>
            </div>
          </div>

          {!oracleHasLiquidity ? (
            <div className="alert" style={{ marginTop: 12, borderColor: "#f59e0b", color: "#f59e0b" }}>
              The price oracle (our swap pool) has no liquidity yet, so collateral can&apos;t be priced and borrowing is
              paused until it&apos;s seeded. Deposits/repayments still work.
            </div>
          ) : vaultBal <= 0n ? (
            <div className="alert" style={{ marginTop: 12 }}>
              The lending pool has <strong>no {TOKEN_SYMBOL} to lend yet</strong>. You can deposit collateral now;
              borrowing opens once the pool is seeded by the authority.
            </div>
          ) : null}

          {/* Your position — only when connected. */}
          {connected ? (
            <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--border, #333)" }}>
              <h4 style={{ margin: "0 0 10px" }}>Your position</h4>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div className="lend-stat">
                  <span className="brief" style={{ fontSize: 12, color: "var(--text-mute)" }}>Collateral</span>
                  <div><strong>{formatLamports(Number(collateralLamports))} SOL</strong></div>
                </div>
                <div className="lend-stat">
                  <span className="brief" style={{ fontSize: 12, color: "var(--text-mute)" }}>Debt (incl. interest)</span>
                  <div><strong>{formatTokensPretty(debt)} {TOKEN_SYMBOL}</strong></div>
                </div>
                <div className="lend-stat">
                  <span className="brief" style={{ fontSize: 12, color: "var(--text-mute)" }}>Borrow limit</span>
                  <div><strong>{oracleHasLiquidity ? <>{formatTokensPretty(limit)} {TOKEN_SYMBOL}</> : "—"}</strong></div>
                </div>
                <div className="lend-stat">
                  <span className="brief" style={{ fontSize: 12, color: "var(--text-mute)" }}>Health factor</span>
                  <div><strong style={{ color: healthTone(health) }}>{health == null ? "—" : `${health.toFixed(2)}×`}</strong></div>
                </div>
              </div>
              {hasDebt && health != null && health < 1.15 ? (
                <div className="brief" style={{ marginTop: 8, fontSize: 13, color: healthTone(health) }}>
                  ⚠️ Health is low. If it reaches 1.00×, your position can be liquidated. Repay or add collateral.
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Actions */}
          {connected ? (
            <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
              {/* Collateral column */}
              <div>
                <h4 style={{ margin: "0 0 8px" }}>Collateral (SOL)</h4>
                <div className="field">
                  <label htmlFor="lend-deposit">Deposit</label>
                  <input id="lend-deposit" inputMode="decimal" placeholder="0.0" value={depositAmt} onChange={(e) => setDepositAmt(e.target.value)} disabled={anyBusy} />
                </div>
                <div className="brief" style={{ marginTop: 6, fontSize: 12, color: "var(--text-mute)" }}>
                  Wallet: {formatLamports(walletSol)} SOL ·{" "}
                  <button type="button" style={linkBtnStyle} onClick={setDepositMax} disabled={anyBusy}>Max</button>
                </div>
                <button className="btn btn-green" style={{ marginTop: 10, width: "100%" }} onClick={() => runAction("deposit")} disabled={anyBusy}>
                  {busy === "deposit" ? "Depositing…" : "Deposit SOL"}
                </button>

                <div className="field" style={{ marginTop: 16 }}>
                  <label htmlFor="lend-withdraw">Withdraw</label>
                  <input id="lend-withdraw" inputMode="decimal" placeholder="0.0" value={withdrawAmt} onChange={(e) => setWithdrawAmt(e.target.value)} disabled={anyBusy} />
                </div>
                <div className="brief" style={{ marginTop: 6, fontSize: 12, color: "var(--text-mute)" }}>
                  Collateral: {formatLamports(Number(collateralLamports))} SOL
                  {!hasDebt ? (
                    <>{" "}· <button type="button" style={linkBtnStyle} onClick={setWithdrawMax} disabled={anyBusy}>Max</button></>
                  ) : (
                    <> · limited by your debt/LTV</>
                  )}
                </div>
                <button className="btn btn-ghost" style={{ marginTop: 10, width: "100%" }} onClick={() => runAction("withdraw")} disabled={anyBusy}>
                  {busy === "withdraw" ? "Withdrawing…" : "Withdraw SOL"}
                </button>
              </div>

              {/* Loan column */}
              <div>
                <h4 style={{ margin: "0 0 8px" }}>Loan ({TOKEN_SYMBOL})</h4>
                <div className="field">
                  <label htmlFor="lend-borrow">Borrow</label>
                  <input id="lend-borrow" inputMode="decimal" placeholder="0.0" value={borrowAmt} onChange={(e) => setBorrowAmt(e.target.value)} disabled={anyBusy || market.paused} />
                </div>
                <div className="brief" style={{ marginTop: 6, fontSize: 12, color: "var(--text-mute)" }}>
                  Available: {oracleHasLiquidity ? formatTokensPretty(availToBorrow) : "—"} {TOKEN_SYMBOL}
                  {oracleHasLiquidity && availToBorrow > 0n ? (
                    <>{" "}· <button type="button" style={linkBtnStyle} onClick={setBorrowMax} disabled={anyBusy || market.paused}>Max</button></>
                  ) : null}
                </div>
                <button className="btn btn-green" style={{ marginTop: 10, width: "100%" }} onClick={() => runAction("borrow")} disabled={anyBusy || market.paused}>
                  {busy === "borrow" ? "Borrowing…" : "Borrow " + TOKEN_SYMBOL}
                </button>

                <div className="field" style={{ marginTop: 16 }}>
                  <label htmlFor="lend-repay">Repay</label>
                  <input id="lend-repay" inputMode="decimal" placeholder="0.0" value={repayAmt} onChange={(e) => setRepayAmt(e.target.value)} disabled={anyBusy} />
                </div>
                <div className="brief" style={{ marginTop: 6, fontSize: 12, color: "var(--text-mute)" }}>
                  Debt: {formatTokensPretty(debt)} {TOKEN_SYMBOL}
                  {hasDebt && walletPlsx > 0n ? (
                    <>{" "}· <button type="button" style={linkBtnStyle} onClick={setRepayMax} disabled={anyBusy}>Max</button></>
                  ) : null}
                </div>
                <button className="btn btn-ghost" style={{ marginTop: 10, width: "100%" }} onClick={() => runAction("repay")} disabled={anyBusy}>
                  {busy === "repay" ? "Repaying…" : "Repay " + TOKEN_SYMBOL}
                </button>
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 16 }}>
              <WalletConnectButton className="btn btn-green btn-block btn-lg" />
            </div>
          )}

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

      <p className="brief" style={{ marginTop: 14, fontSize: 12, color: "var(--text-mute)" }}>
        {loading ? "Reading on-chain state… " : ""}
        Devnet {TOKEN_SYMBOL} has no monetary value. Collateral is priced by a single on-chain AMM (our swap pool), so
        the price can move with trades; if your debt exceeds the liquidation threshold your collateral can be liquidated.
        Interest accrues linearly at the APR shown and is settled on every interaction.
      </p>
    </div>
  );
}
