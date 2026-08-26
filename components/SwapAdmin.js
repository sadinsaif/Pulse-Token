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
import { TOKEN_SYMBOL, SWAP_AUTHORITY } from "@/lib/config";
import {
  readPool,
  readTokenVaultBalance,
  initializePoolInstructions,
  addLiquidityInstructions,
  removeLiquidityInstructions,
  setFeeBpsInstructions,
  sendInstructions,
  parseAmountToBase,
  feeBpsFromPercent,
  feePercentFromBps,
  plsxPerSol,
} from "@/lib/swap";

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
  return msg.length > 200 ? msg.slice(0, 200) + "…" : msg;
}

/**
 * Authority-only SWAP admin: initialize the pool, seed/withdraw liquidity, and set
 * the fee. It renders for NO ONE except the exact SWAP_AUTHORITY wallet (a public
 * address in config — never a secret). Every action is a plain transaction signed
 * by that wallet; there is no embedded key. Add-liquidity moves the authority's own
 * PLSX + SOL into the pool — the ratio it seeds sets the opening price.
 */
export default function SwapAdmin({ network: pinned }) {
  const ctx = useNetwork();
  const network = pinned || ctx.network;
  const { publicKey, connected, sendTransaction } = useWallet();

  const [mounted, setMounted] = useState(false);
  const [busy, setBusy] = useState(null); // "init" | "fee" | "add" | "remove" | null
  const [error, setError] = useState("");
  const [okSig, setOkSig] = useState("");

  const [pool, setPool] = useState(null);
  const [tokenVaultBal, setTokenVaultBal] = useState(0n);
  const [authPlsx, setAuthPlsx] = useState(0n);
  const [authSol, setAuthSol] = useState(0); // lamports (Number)

  const [feeInput, setFeeInput] = useState("0.3");
  const [addPlsx, setAddPlsx] = useState("");
  const [addSol, setAddSol] = useState("");
  const [remPlsx, setRemPlsx] = useState("");
  const [remSol, setRemSol] = useState("");

  useEffect(() => setMounted(true), []);

  const address = publicKey?.toBase58() || "";
  const isAuthority = mounted && connected && address === SWAP_AUTHORITY;
  // Gate on the PLSX mint (devnet), NOT the public features.swap flag — the
  // authority must be able to initialize + seed BEFORE that flag flips.
  const enabled = Boolean(network.mint);

  const cancelledRef = useRef(false);
  const refresh = useCallback(async () => {
    if (!enabled || !isAuthority) return;
    try {
      const conn = connectionFor(network.rpc);
      const [p, tv, plsx, sol] = await Promise.all([
        readPool(conn),
        readTokenVaultBalance(conn),
        getSplBalanceBaseFor(conn, network.mint, address),
        getSolBalanceFor(conn, address),
      ]);
      if (cancelledRef.current) return;
      setPool(p);
      setTokenVaultBal(tv);
      setAuthPlsx(plsx);
      setAuthSol(sol);
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
        const feeBps = feeBpsFromPercent(feeInput);
        if (feeBps == null) throw new Error("Enter a valid fee percentage (e.g. 0.3).");
        ixs = initializePoolInstructions(publicKey, feeBps);
      } else if (kind === "fee") {
        const feeBps = feeBpsFromPercent(feeInput);
        if (feeBps == null) throw new Error("Enter a valid fee percentage.");
        ixs = setFeeBpsInstructions(publicKey, feeBps);
      } else if (kind === "add") {
        const tokenBase = parseAmountToBase(addPlsx);
        const solBase = parseAmountToBase(addSol);
        if (tokenBase == null || tokenBase <= 0n) throw new Error(`Enter a valid ${TOKEN_SYMBOL} amount.`);
        if (solBase == null || solBase <= 0n) throw new Error("Enter a valid SOL amount.");
        if (tokenBase > authPlsx) throw new Error(`Your wallet holds ${formatTokensPretty(authPlsx)} ${TOKEN_SYMBOL}.`);
        if (solBase > BigInt(authSol)) throw new Error(`Your wallet holds ${formatLamports(authSol)} SOL.`);
        ixs = addLiquidityInstructions(publicKey, tokenBase, solBase);
      } else {
        // remove
        const tokenBase = parseAmountToBase(remPlsx);
        const solBase = parseAmountToBase(remSol);
        if (tokenBase == null || tokenBase < 0n) throw new Error(`Enter a valid ${TOKEN_SYMBOL} amount.`);
        if (solBase == null || solBase < 0n) throw new Error("Enter a valid SOL amount.");
        if (tokenBase <= 0n && solBase <= 0n) throw new Error("Enter an amount to withdraw.");
        if (pool && tokenBase > pool.tokenReserve) throw new Error(`Pool holds ${formatTokensPretty(pool.tokenReserve)} ${TOKEN_SYMBOL}.`);
        if (pool && solBase > pool.solReserve) throw new Error(`Pool holds ${formatLamports(pool.solReserve)} SOL.`);
        ixs = removeLiquidityInstructions(publicKey, tokenBase, solBase);
      }
      const sig = await sendInstructions({ conn, ixs, publicKey, sendTransaction });
      setOkSig(sig);
      if (kind === "add") { setAddPlsx(""); setAddSol(""); }
      if (kind === "remove") { setRemPlsx(""); setRemSol(""); }
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
  const anyBusy = busy != null;
  const price = plsxPerSol(pool);

  return (
    <div className="panel" style={{ ...panelStyle, borderColor: "var(--green, #22c55e)", marginBottom: 24 }}>
      <div
        className="panel-head"
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}
      >
        <h3 style={{ margin: 0 }}>Swap Admin</h3>
        <span className={`tag-pill tone-${network.tone}`}>Authority</span>
      </div>

      <p className="brief" style={{ marginTop: 8 }}>
        You are connected as the pool authority. These actions are signed by <strong>your</strong> wallet
        (no key is stored anywhere). Pool:{" "}
        <strong>{initialized ? "Initialized" : "Not initialized"}</strong>
        {initialized ? (
          <>
            {" "}· fee {feePercentFromBps(pool.feeBps)}% · reserves {formatTokensPretty(pool.tokenReserve)} {TOKEN_SYMBOL} / {formatLamports(pool.solReserve)} SOL
            {price ? <> · 1 SOL ≈ {formatTokensPretty(BigInt(Math.round(price)))} {TOKEN_SYMBOL}</> : null}
          </>
        ) : null}.
      </p>

      {/* Fee % — used for both initialize and set-fee */}
      <div className="field" style={{ marginTop: 12 }}>
        <label htmlFor="admin-fee">Swap fee %</label>
        <input
          id="admin-fee"
          inputMode="decimal"
          placeholder="0.3"
          value={feeInput}
          onChange={(e) => setFeeInput(e.target.value)}
          disabled={anyBusy}
        />
      </div>
      <div className="brief" style={{ marginTop: 6, fontSize: 13, color: "var(--text-mute)" }}>
        On-chain fee_bps = {feeBpsFromPercent(feeInput) != null ? feeBpsFromPercent(feeInput).toString() : "—"} (out of 10,000; max 10%).
      </div>
      <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        {!initialized ? (
          <button className="btn btn-green" onClick={() => runAction("init")} disabled={anyBusy}>
            {busy === "init" ? "Initializing…" : "Initialize pool"}
          </button>
        ) : (
          <button className="btn btn-ghost" onClick={() => runAction("fee")} disabled={anyBusy}>
            {busy === "fee" ? "Updating…" : "Set fee"}
          </button>
        )}
      </div>

      {/* Add liquidity — authority's own PLSX + SOL; the ratio sets the price */}
      <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border, #333)" }}>
        <h4 style={{ margin: "0 0 4px" }}>Add liquidity</h4>
        <p className="brief" style={{ marginTop: 0, fontSize: 13, color: "var(--text-mute)" }}>
          Wallet: {formatTokensPretty(authPlsx)} {TOKEN_SYMBOL} · {formatLamports(authSol)} SOL.
          {!initialized ? " The first deposit's ratio sets the opening price (e.g. 1000 PLSX + 1 SOL ⇒ 1 SOL ≈ 1000 PLSX)." : ""}
        </p>
        <div className="field" style={{ marginTop: 8 }}>
          <label htmlFor="add-plsx">{TOKEN_SYMBOL} amount</label>
          <input id="add-plsx" inputMode="decimal" placeholder="0.0" value={addPlsx} onChange={(e) => setAddPlsx(e.target.value)} disabled={anyBusy || !initialized} />
        </div>
        <div className="brief" style={{ marginTop: 6, fontSize: 13, color: "var(--text-mute)" }}>
          <button type="button" style={linkBtnStyle} onClick={() => setAddPlsx(formatTokens(authPlsx))} disabled={anyBusy || !initialized}>Max {TOKEN_SYMBOL}</button>
        </div>
        <div className="field" style={{ marginTop: 8 }}>
          <label htmlFor="add-sol">SOL amount</label>
          <input id="add-sol" inputMode="decimal" placeholder="0.0" value={addSol} onChange={(e) => setAddSol(e.target.value)} disabled={anyBusy || !initialized} />
        </div>
        <div className="brief" style={{ marginTop: 6, fontSize: 13, color: "var(--text-mute)" }}>
          <button
            type="button"
            style={linkBtnStyle}
            onClick={() => setAddSol(formatTokens(BigInt(authSol) > SOL_FEE_BUFFER ? BigInt(authSol) - SOL_FEE_BUFFER : 0n))}
            disabled={anyBusy || !initialized}
          >
            Max SOL
          </button>
        </div>
        <div style={{ marginTop: 12 }}>
          <button className="btn btn-green" onClick={() => runAction("add")} disabled={anyBusy || !initialized}>
            {busy === "add" ? "Adding…" : "Add liquidity"}
          </button>
        </div>
      </div>

      {/* Remove liquidity */}
      <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border, #333)" }}>
        <h4 style={{ margin: "0 0 4px" }}>Remove liquidity</h4>
        <p className="brief" style={{ marginTop: 0, fontSize: 13, color: "var(--text-mute)" }}>
          Withdraw from the pool back to your wallet (the pool stays rent-exempt on-chain).
        </p>
        <div className="field" style={{ marginTop: 8 }}>
          <label htmlFor="rem-plsx">{TOKEN_SYMBOL} amount</label>
          <input id="rem-plsx" inputMode="decimal" placeholder="0.0" value={remPlsx} onChange={(e) => setRemPlsx(e.target.value)} disabled={anyBusy || !initialized} />
        </div>
        <div className="brief" style={{ marginTop: 6, fontSize: 13, color: "var(--text-mute)" }}>
          <button type="button" style={linkBtnStyle} onClick={() => setRemPlsx(formatTokens(pool?.tokenReserve ?? 0n))} disabled={anyBusy || !initialized}>Max {TOKEN_SYMBOL}</button>
        </div>
        <div className="field" style={{ marginTop: 8 }}>
          <label htmlFor="rem-sol">SOL amount</label>
          <input id="rem-sol" inputMode="decimal" placeholder="0.0" value={remSol} onChange={(e) => setRemSol(e.target.value)} disabled={anyBusy || !initialized} />
        </div>
        <div className="brief" style={{ marginTop: 6, fontSize: 13, color: "var(--text-mute)" }}>
          <button type="button" style={linkBtnStyle} onClick={() => setRemSol(formatTokens(pool?.solReserve ?? 0n))} disabled={anyBusy || !initialized}>Max SOL</button>
        </div>
        <div style={{ marginTop: 12 }}>
          <button className="btn btn-ghost" onClick={() => runAction("remove")} disabled={anyBusy || !initialized}>
            {busy === "remove" ? "Removing…" : "Remove liquidity"}
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
