"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useNetwork } from "@/components/NetworkProvider";
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
  readVaultBalance,
  readOraclePool,
  initializeMarketInstructions,
  seedPoolInstructions,
  withdrawPoolInstructions,
  setParamsInstructions,
  setPausedInstructions,
  sendInstructions,
  parseAmountToBase,
  plsxPerSol,
  pctFromBps,
  bpsFromPct,
  LEND_AUTHORITY,
  MAX_APR_BPS,
  MAX_LTV_BPS,
  MAX_LIQ_BONUS_BPS,
} from "@/lib/lend";

const panelStyle = { maxWidth: 720, margin: "0 auto" };
const linkBtnStyle = {
  background: "none",
  border: "none",
  padding: 0,
  font: "inherit",
  color: "var(--green, #22c55e)",
  cursor: "pointer",
  textDecoration: "underline",
};
// Keep 0.01 SOL aside on "Max" so the seeding tx can still pay its own fee.
const SOL_FEE_BUFFER = 10_000_000n; // lamports

function prettyError(e) {
  const msg = (e && (e.message || e.toString())) || "Something went wrong.";
  if (/user rejected|rejected the request|declined/i.test(msg)) return "You cancelled the transaction.";
  if (/BadParam|0x177b/i.test(msg)) return "Invalid risk parameter — check the caps (APR ≤ 200%, LTV ≤ 90%, threshold in (LTV, 100%], bonus ≤ 20%).";
  return msg.length > 200 ? msg.slice(0, 200) + "…" : msg;
}

/**
 * Authority-only LEND admin: initialize the market, seed/withdraw the PLSX lending
 * pool, tune risk params, and pause/unpause borrowing. Renders for NO ONE except the
 * exact LEND_AUTHORITY wallet (a public address in config — never a secret). Every
 * action is a plain transaction signed by that wallet; there is no embedded key.
 * Seeding moves the authority's own PLSX into the pool — that PLSX is what users borrow.
 */
export default function LendAdmin({ network: pinned }) {
  const ctx = useNetwork();
  const network = pinned || ctx.network;
  const { publicKey, connected, sendTransaction } = useWallet();

  const [mounted, setMounted] = useState(false);
  const [busy, setBusy] = useState(null); // "init" | "params" | "pause" | "seed" | "withdraw" | null
  const [error, setError] = useState("");
  const [okSig, setOkSig] = useState("");

  const [market, setMarket] = useState(null);
  const [vaultBal, setVaultBal] = useState(0n);
  const [oracle, setOracle] = useState(null);
  const [authPlsx, setAuthPlsx] = useState(0n);
  const [authSol, setAuthSol] = useState(0); // lamports (Number)

  // Risk params (percent inputs) — MVP defaults: APR 10 / LTV 50 / liq 60 / bonus 5.
  const [aprInput, setAprInput] = useState("10");
  const [ltvInput, setLtvInput] = useState("50");
  const [liqInput, setLiqInput] = useState("60");
  const [bonusInput, setBonusInput] = useState("5");

  const [seedAmt, setSeedAmt] = useState("");
  const [wpoolAmt, setWpoolAmt] = useState("");

  useEffect(() => setMounted(true), []);

  const address = publicKey?.toBase58() || "";
  const isAuthority = mounted && connected && address === LEND_AUTHORITY;
  // Gate on the PLSX mint (devnet), NOT the public features.lend flag — the
  // authority must be able to initialize + seed BEFORE that flag flips.
  const enabled = Boolean(network.mint);

  const cancelledRef = useRef(false);
  const refresh = useCallback(async () => {
    if (!enabled || !isAuthority) return;
    try {
      const conn = connectionFor(network.rpc);
      const [m, v, o, plsx, sol] = await Promise.all([
        readMarket(conn),
        readVaultBalance(conn),
        readOraclePool(conn),
        getSplBalanceBaseFor(conn, network.mint, address),
        getSolBalanceFor(conn, address),
      ]);
      if (cancelledRef.current) return;
      setMarket(m);
      setVaultBal(v);
      setOracle(o);
      setAuthPlsx(plsx);
      setAuthSol(sol);
      // Reflect on-chain params into the inputs once, so "Set params" starts from truth.
      if (m) {
        setAprInput(pctFromBps(m.borrowAprBps));
        setLtvInput(pctFromBps(m.ltvBps));
        setLiqInput(pctFromBps(m.liqThresholdBps));
        setBonusInput(pctFromBps(m.liqBonusBps));
      }
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

  // Parse + validate the four risk params against the on-chain caps. Returns the
  // bps object or throws a friendly error (mirrors the program's require!s).
  function readParams() {
    const aprBps = bpsFromPct(aprInput);
    const ltvBps = bpsFromPct(ltvInput);
    const liqThresholdBps = bpsFromPct(liqInput);
    const liqBonusBps = bpsFromPct(bonusInput);
    if (aprBps == null || ltvBps == null || liqThresholdBps == null || liqBonusBps == null)
      throw new Error("Enter valid percentages for all four parameters.");
    if (aprBps > MAX_APR_BPS) throw new Error("APR cannot exceed 200%.");
    if (ltvBps > MAX_LTV_BPS) throw new Error("LTV cannot exceed 90%.");
    if (!(liqThresholdBps > ltvBps && liqThresholdBps <= 10_000n))
      throw new Error("Liquidation threshold must be above LTV and at most 100%.");
    if (liqBonusBps > MAX_LIQ_BONUS_BPS) throw new Error("Liquidation bonus cannot exceed 20%.");
    return {
      aprBps: Number(aprBps),
      ltvBps: Number(ltvBps),
      liqThresholdBps: Number(liqThresholdBps),
      liqBonusBps: Number(liqBonusBps),
    };
  }

  async function runAction(kind) {
    setError("");
    setOkSig("");
    setBusy(kind);
    try {
      const conn = connectionFor(network.rpc);
      let ixs;
      if (kind === "init") {
        const params = readParams();
        ixs = initializeMarketInstructions(publicKey, params); // oracle defaults to our swap pool
      } else if (kind === "params") {
        const params = readParams();
        ixs = setParamsInstructions(publicKey, params);
      } else if (kind === "pause") {
        ixs = setPausedInstructions(publicKey, !market?.paused);
      } else if (kind === "seed") {
        const amt = parseAmountToBase(seedAmt);
        if (amt == null || amt <= 0n) throw new Error(`Enter a valid ${TOKEN_SYMBOL} amount.`);
        if (amt > authPlsx) throw new Error(`Your wallet holds ${formatTokensPretty(authPlsx)} ${TOKEN_SYMBOL}.`);
        ixs = seedPoolInstructions(publicKey, amt);
      } else {
        // withdraw pool
        const amt = parseAmountToBase(wpoolAmt);
        if (amt == null || amt <= 0n) throw new Error(`Enter a valid ${TOKEN_SYMBOL} amount.`);
        if (amt > vaultBal) throw new Error(`The pool holds ${formatTokensPretty(vaultBal)} ${TOKEN_SYMBOL}.`);
        ixs = withdrawPoolInstructions(publicKey, amt);
      }
      const sig = await sendInstructions({ conn, ixs, publicKey, sendTransaction });
      setOkSig(sig);
      if (kind === "seed") setSeedAmt("");
      if (kind === "withdraw") setWpoolAmt("");
      await refresh();
    } catch (e) {
      setError(prettyError(e));
    } finally {
      setBusy(null);
    }
  }

  // Invisible to everyone but the authority wallet, and only where PLSX exists.
  if (!isAuthority || !enabled) return null;

  const initialized = Boolean(market);
  const anyBusy = busy != null;
  const price = plsxPerSol(oracle);
  const priceStr = price == null ? null : price.toLocaleString("en-US", { maximumFractionDigits: price >= 1 ? 2 : 6 });
  const oracleHasLiquidity = Boolean(oracle && oracle.tokenReserve > 0n && oracle.solReserve > 0n);

  return (
    <div className="panel" style={{ ...panelStyle, borderColor: "var(--green, #22c55e)", marginBottom: 24 }}>
      <div
        className="panel-head"
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}
      >
        <h3 style={{ margin: 0 }}>Lend Admin</h3>
        <span className={`tag-pill tone-${network.tone}`}>Authority</span>
      </div>

      <p className="brief" style={{ marginTop: 8 }}>
        You are connected as the market authority. These actions are signed by <strong>your</strong> wallet
        (no key is stored anywhere). Market:{" "}
        <strong>{initialized ? "Initialized" : "Not initialized"}</strong>
        {initialized ? (
          <>
            {" "}· APR {pctFromBps(market.borrowAprBps)}% · LTV {pctFromBps(market.ltvBps)}% · liq {pctFromBps(market.liqThresholdBps)}%
            {" "}· bonus {pctFromBps(market.liqBonusBps)}% · borrowed {formatTokensPretty(market.totalBorrowed)} {TOKEN_SYMBOL}
            {market.paused ? " · ⏸ PAUSED" : ""}
            {" "}· pool holds {formatTokensPretty(vaultBal)} {TOKEN_SYMBOL}
          </>
        ) : null}.
      </p>

      {/* Oracle status — borrowing needs the swap pool to have liquidity. */}
      <div
        className="brief"
        style={{ marginTop: 6, fontSize: 13, color: oracleHasLiquidity ? "var(--text-mute)" : "#f59e0b" }}
      >
        {oracleHasLiquidity
          ? <>Price oracle (our swap pool): 1 SOL ≈ {priceStr} {TOKEN_SYMBOL}.</>
          : <>⚠️ The price oracle (swap pool) has no liquidity — borrowing will revert until the swap pool is seeded.</>}
      </div>

      {/* Risk params — used for both Initialize and Set params */}
      <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border, #333)" }}>
        <h4 style={{ margin: "0 0 8px" }}>Risk parameters</h4>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12 }}>
          <div className="field">
            <label htmlFor="lend-apr">Borrow APR %</label>
            <input id="lend-apr" inputMode="decimal" placeholder="10" value={aprInput} onChange={(e) => setAprInput(e.target.value)} disabled={anyBusy} />
          </div>
          <div className="field">
            <label htmlFor="lend-ltv">LTV %</label>
            <input id="lend-ltv" inputMode="decimal" placeholder="50" value={ltvInput} onChange={(e) => setLtvInput(e.target.value)} disabled={anyBusy} />
          </div>
          <div className="field">
            <label htmlFor="lend-liq">Liq. threshold %</label>
            <input id="lend-liq" inputMode="decimal" placeholder="60" value={liqInput} onChange={(e) => setLiqInput(e.target.value)} disabled={anyBusy} />
          </div>
          <div className="field">
            <label htmlFor="lend-bonus">Liq. bonus %</label>
            <input id="lend-bonus" inputMode="decimal" placeholder="5" value={bonusInput} onChange={(e) => setBonusInput(e.target.value)} disabled={anyBusy} />
          </div>
        </div>
        <div className="brief" style={{ marginTop: 6, fontSize: 13, color: "var(--text-mute)" }}>
          Caps: APR ≤ 200%, LTV ≤ 90%, threshold must be above LTV and ≤ 100%, bonus ≤ 20%.
        </div>
        <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          {!initialized ? (
            <button className="btn btn-green" onClick={() => runAction("init")} disabled={anyBusy}>
              {busy === "init" ? "Initializing…" : "Initialize market"}
            </button>
          ) : (
            <>
              <button className="btn btn-ghost" onClick={() => runAction("params")} disabled={anyBusy}>
                {busy === "params" ? "Updating…" : "Set params"}
              </button>
              <button className="btn btn-ghost" onClick={() => runAction("pause")} disabled={anyBusy}>
                {busy === "pause" ? "Working…" : market.paused ? "Unpause borrowing" : "Pause borrowing"}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Seed pool — authority's own PLSX becomes the borrow-able liquidity */}
      <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border, #333)" }}>
        <h4 style={{ margin: "0 0 4px" }}>Seed lending pool</h4>
        <p className="brief" style={{ marginTop: 0, fontSize: 13, color: "var(--text-mute)" }}>
          Wallet: {formatTokensPretty(authPlsx)} {TOKEN_SYMBOL} · {formatLamports(authSol)} SOL. This PLSX is what users borrow against their SOL.
        </p>
        <div className="field" style={{ marginTop: 8 }}>
          <label htmlFor="lend-seed">{TOKEN_SYMBOL} amount</label>
          <input id="lend-seed" inputMode="decimal" placeholder="0.0" value={seedAmt} onChange={(e) => setSeedAmt(e.target.value)} disabled={anyBusy || !initialized} />
        </div>
        <div className="brief" style={{ marginTop: 6, fontSize: 13, color: "var(--text-mute)" }}>
          <button type="button" style={linkBtnStyle} onClick={() => setSeedAmt(formatTokens(authPlsx))} disabled={anyBusy || !initialized}>Max {TOKEN_SYMBOL}</button>
        </div>
        <div style={{ marginTop: 12 }}>
          <button className="btn btn-green" onClick={() => runAction("seed")} disabled={anyBusy || !initialized}>
            {busy === "seed" ? "Seeding…" : "Seed pool"}
          </button>
        </div>
      </div>

      {/* Withdraw pool */}
      <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border, #333)" }}>
        <h4 style={{ margin: "0 0 4px" }}>Withdraw from pool</h4>
        <p className="brief" style={{ marginTop: 0, fontSize: 13, color: "var(--text-mute)" }}>
          Pull surplus PLSX back to your wallet. The pool currently holds {formatTokensPretty(vaultBal)} {TOKEN_SYMBOL}.
        </p>
        <div className="field" style={{ marginTop: 8 }}>
          <label htmlFor="lend-wpool">{TOKEN_SYMBOL} amount</label>
          <input id="lend-wpool" inputMode="decimal" placeholder="0.0" value={wpoolAmt} onChange={(e) => setWpoolAmt(e.target.value)} disabled={anyBusy || !initialized} />
        </div>
        <div className="brief" style={{ marginTop: 6, fontSize: 13, color: "var(--text-mute)" }}>
          <button type="button" style={linkBtnStyle} onClick={() => setWpoolAmt(formatTokens(vaultBal))} disabled={anyBusy || !initialized}>Max {TOKEN_SYMBOL}</button>
        </div>
        <div style={{ marginTop: 12 }}>
          <button className="btn btn-ghost" onClick={() => runAction("withdraw")} disabled={anyBusy || !initialized}>
            {busy === "withdraw" ? "Withdrawing…" : "Withdraw pool"}
          </button>
        </div>
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
