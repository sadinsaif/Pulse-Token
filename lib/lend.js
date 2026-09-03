// ============================================================================
// PULSE (PLSX) lend — client for the REAL on-chain money-market (DEVNET).
// ----------------------------------------------------------------------------
// Talks to the Anchor program deployed at LEND_PROGRAM_ID (see
// anchor/pulse_lend/src/lib.rs). HAND-ROLLED on plain @solana/web3.js — NO
// @coral-xyz/anchor, NO @solana/spl-token, NO IDL — so there is no Anchor-version
// / dependency fragility and NOTHING new to install. Small generic helpers
// (ata, sendInstructions, parseAmountToBase) + the ORACLE reader (readPool) are
// reused from lib/swap.js, because the lend price oracle IS our own swap pool.
//
// The market: a user deposits NATIVE SOL as collateral (held as lamports in the
// Market PDA) and borrows PLSX from a PDA-owned vault against it. Price comes from
// our swap pool's live reserves. Only the authority seeds the PLSX pool; regular
// users deposit / borrow / repay / withdraw. Anyone may liquidate an unhealthy
// position.
//
// HONESTY / SAFETY:
//  * Every figure the UI shows is READ straight from chain (market params, vault
//    balance, the borrower's collateral/debt, and the swap-pool price). Borrow
//    limits / health are computed with the EXACT integer math the program uses.
//    An empty vault or uninitialized market yields honest zeros / "not available",
//    never a fabricated number.
//  * This module NEVER holds a key. It only BUILDS unsigned instructions; the
//    user's wallet signs (sendInstructions → wallet-adapter sendTransaction).
//  * Anchor discriminators are the first 8 bytes of sha256("global:<ix>") /
//    sha256("account:<Acct>"), pinned here — they match the deployed program.
// ============================================================================

import { Buffer } from "buffer";
import {
  PublicKey,
  TransactionInstruction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import {
  LEND_PROGRAM_ID as CFG_PROGRAM_ID,
  LEND_AUTHORITY as CFG_LEND_AUTHORITY,
  DECIMALS,
} from "@/lib/config";
// The oracle is our own swap pool → reuse its reader + PDA + generic helpers.
import {
  MINT,
  TOKEN_PROGRAM_ID,
  poolPda as swapPoolPda,
  readPool as readSwapPool,
  plsxPerSol,
  ataFor,
  createAtaIdempotentIx,
  sendInstructions,
  parseAmountToBase,
} from "@/lib/swap";

// ── Program-level constants ────────────────────────────────────────────────
export const PROGRAM_ID = new PublicKey(CFG_PROGRAM_ID);
export const LEND_AUTHORITY = CFG_LEND_AUTHORITY; // base58 string

// Must match the Rust program (basis points out of 10_000).
export const BPS_DENOM = 10_000n;
export const MAX_APR_BPS = 20_000n; // 200% APR hard cap
export const MAX_LTV_BPS = 9_000n; // never lend above 90% of collateral value
export const MAX_LIQ_BONUS_BPS = 2_000n; // liquidation bonus capped at 20%

// Re-export the shared helpers/values so components import one module.
export { MINT, plsxPerSol, sendInstructions, parseAmountToBase, ataFor };

// Anchor 8-byte discriminators (sha256("global:name") / sha256("account:Name")).
const DISC = {
  initialize_market: Uint8Array.from([35, 35, 189, 193, 155, 48, 170, 203]),
  set_params: Uint8Array.from([27, 234, 178, 52, 147, 2, 187, 141]),
  set_paused: Uint8Array.from([91, 60, 125, 192, 176, 225, 166, 218]),
  seed_pool: Uint8Array.from([111, 214, 148, 46, 108, 2, 217, 18]),
  withdraw_pool: Uint8Array.from([190, 43, 148, 248, 68, 5, 215, 136]),
  open_position: Uint8Array.from([135, 128, 47, 77, 15, 152, 240, 49]),
  deposit_collateral: Uint8Array.from([156, 131, 142, 116, 146, 247, 162, 120]),
  borrow: Uint8Array.from([228, 253, 131, 202, 207, 116, 89, 18]),
  repay: Uint8Array.from([234, 103, 67, 82, 208, 234, 219, 166]),
  withdraw_collateral: Uint8Array.from([115, 135, 168, 106, 139, 214, 138, 150]),
  liquidate: Uint8Array.from([223, 179, 226, 125, 48, 46, 39, 74]),
};
const ACCT_DISC = {
  Market: Uint8Array.from([219, 190, 213, 55, 0, 227, 198, 154]),
  Position: Uint8Array.from([170, 188, 143, 228, 122, 64, 247, 208]),
};

// ── PDA derivations (mirror the Rust seeds exactly) ─────────────────────────
export function marketPda() {
  return PublicKey.findProgramAddressSync([Buffer.from("market"), MINT.toBuffer()], PROGRAM_ID)[0];
}
export function plsxVaultPda(market = marketPda()) {
  return PublicKey.findProgramAddressSync([Buffer.from("lend_plsx_vault"), market.toBuffer()], PROGRAM_ID)[0];
}
export function positionPda(owner, market = marketPda()) {
  const o = owner instanceof PublicKey ? owner : new PublicKey(owner);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("position"), market.toBuffer(), o.toBuffer()],
    PROGRAM_ID
  )[0];
}

// ── encoding helpers ─────────────────────────────────────────────────────────
function u64le(value) {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(value), true);
  return b;
}
function concatBytes(...arrs) {
  const len = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const a of arrs) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}
function ix(keys, data) {
  return new TransactionInstruction({ programId: PROGRAM_ID, keys, data: Buffer.from(data) });
}
const key = (pubkey, isSigner, isWritable) => ({ pubkey, isSigner, isWritable });

// ── instruction builders (account order MUST match the Rust #[derive(Accounts)]) ─

/** Authority-only. Creates the market + PLSX lending vault and pins the oracle. */
export function initializeMarketIx(authority, { aprBps, ltvBps, liqThresholdBps, liqBonusBps }, swapPool = swapPoolPda()) {
  const market = marketPda();
  return ix(
    [
      key(authority, true, true), // authority (mut, signer)
      key(MINT, false, false), // mint
      key(swapPool, false, false), // swap_pool (oracle, pinned)
      key(market, false, true), // market (init)
      key(plsxVaultPda(market), false, true), // plsx_vault (init)
      key(TOKEN_PROGRAM_ID, false, false),
      key(SystemProgram.programId, false, false),
      key(SYSVAR_RENT_PUBKEY, false, false),
    ],
    concatBytes(DISC.initialize_market, u64le(aprBps), u64le(ltvBps), u64le(liqThresholdBps), u64le(liqBonusBps))
  );
}

/** Authority-only. Adjust risk params (same caps as init). */
export function setParamsIx(authority, { aprBps, ltvBps, liqThresholdBps, liqBonusBps }) {
  return ix(
    [key(authority, true, false), key(marketPda(), false, true)],
    concatBytes(DISC.set_params, u64le(aprBps), u64le(ltvBps), u64le(liqThresholdBps), u64le(liqBonusBps))
  );
}

/** Authority-only. Pause / unpause new borrows (repay/withdraw/liquidate stay open). */
export function setPausedIx(authority, paused) {
  return ix(
    [key(authority, true, false), key(marketPda(), false, true)],
    concatBytes(DISC.set_paused, Uint8Array.from([paused ? 1 : 0]))
  );
}

/** Authority-only. Supply PLSX into the borrow-able lending vault. */
export function seedPoolIx(authority, amountBase) {
  const market = marketPda();
  return ix(
    [
      key(authority, true, false), // authority (signer)
      key(market, false, false), // market
      key(plsxVaultPda(market), false, true), // plsx_vault (mut)
      key(ataFor(authority), false, true), // authority_token (mut)
      key(TOKEN_PROGRAM_ID, false, false),
    ],
    concatBytes(DISC.seed_pool, u64le(amountBase))
  );
}

/** Authority-only. Withdraw surplus PLSX from the lending vault. */
export function withdrawPoolIx(authority, amountBase) {
  const market = marketPda();
  return ix(
    [
      key(authority, true, false),
      key(market, false, false),
      key(plsxVaultPda(market), false, true),
      key(ataFor(authority), false, true),
      key(TOKEN_PROGRAM_ID, false, false),
    ],
    concatBytes(DISC.withdraw_pool, u64le(amountBase))
  );
}

/** User creates their Position PDA (one-time, before first deposit). */
export function openPositionIx(owner) {
  const market = marketPda();
  return ix(
    [
      key(owner, true, true), // owner (mut, signer)
      key(market, false, false), // market
      key(positionPda(owner, market), false, true), // position (init)
      key(SystemProgram.programId, false, false),
    ],
    DISC.open_position
  );
}

/** User deposits `lamports` of native SOL as collateral. */
export function depositCollateralIx(owner, lamports) {
  const market = marketPda();
  return ix(
    [
      key(owner, true, true), // owner (mut, signer)
      key(market, false, true), // market (mut — receives SOL)
      key(positionPda(owner, market), false, true), // position (mut)
      key(SystemProgram.programId, false, false),
    ],
    concatBytes(DISC.deposit_collateral, u64le(lamports))
  );
}

/** User borrows `amount` PLSX against their collateral. */
export function borrowIx(owner, amountBase, swapPool = swapPoolPda()) {
  const market = marketPda();
  return ix(
    [
      key(owner, true, true), // owner (mut, signer)
      key(market, false, true), // market (mut — total_borrowed)
      key(positionPda(owner, market), false, true), // position (mut)
      key(plsxVaultPda(market), false, true), // plsx_vault (mut)
      key(ataFor(owner), false, true), // owner_token (mut)
      key(swapPool, false, false), // swap_pool (oracle)
      key(TOKEN_PROGRAM_ID, false, false),
    ],
    concatBytes(DISC.borrow, u64le(amountBase))
  );
}

/** User repays up to their outstanding PLSX debt. */
export function repayIx(owner, amountBase) {
  const market = marketPda();
  return ix(
    [
      key(owner, true, true), // owner (mut, signer)
      key(market, false, true), // market (mut — total_borrowed)
      key(positionPda(owner, market), false, true), // position (mut)
      key(plsxVaultPda(market), false, true), // plsx_vault (mut)
      key(ataFor(owner), false, true), // owner_token (mut)
      key(TOKEN_PROGRAM_ID, false, false),
    ],
    concatBytes(DISC.repay, u64le(amountBase))
  );
}

/** User withdraws `lamports` of collateral (if it still covers the debt within LTV). */
export function withdrawCollateralIx(owner, lamports, swapPool = swapPoolPda()) {
  const market = marketPda();
  return ix(
    [
      key(owner, true, true), // owner (mut, signer)
      key(market, false, true), // market (mut — pays SOL out)
      key(positionPda(owner, market), false, true), // position (mut)
      key(swapPool, false, false), // swap_pool (oracle)
    ],
    concatBytes(DISC.withdraw_collateral, u64le(lamports))
  );
}

/** Anyone. Liquidate an unhealthy position (liquidator repays full debt, seizes SOL). */
export function liquidateIx(liquidator, targetOwner, swapPool = swapPoolPda()) {
  const market = marketPda();
  return ix(
    [
      key(liquidator, true, true), // liquidator (mut, signer)
      key(market, false, true), // market (mut)
      key(positionPda(targetOwner, market), false, true), // position (mut — target)
      key(plsxVaultPda(market), false, true), // plsx_vault (mut)
      key(ataFor(liquidator), false, true), // liquidator_token (mut)
      key(swapPool, false, false), // swap_pool (oracle)
      key(TOKEN_PROGRAM_ID, false, false),
    ],
    DISC.liquidate
  );
}

// ── high-level instruction assemblers ─────────────────────────────────────────
// Deposit auto-opens the position first-time; borrow prepends an idempotent create
// of the borrower's PLSX ATA (a first-time borrower may have none).
export function depositCollateralInstructions(owner, lamports, { needsOpen } = {}) {
  const list = [];
  if (needsOpen) list.push(openPositionIx(owner));
  list.push(depositCollateralIx(owner, lamports));
  return list;
}
export function borrowInstructions(owner, amountBase, swapPool) {
  return [createAtaIdempotentIx(owner, owner), borrowIx(owner, amountBase, swapPool)];
}
export function repayInstructions(owner, amountBase) {
  return [repayIx(owner, amountBase)];
}
export function withdrawCollateralInstructions(owner, lamports, swapPool) {
  return [withdrawCollateralIx(owner, lamports, swapPool)];
}
export function initializeMarketInstructions(authority, params, swapPool) {
  return [initializeMarketIx(authority, params, swapPool)];
}
export function seedPoolInstructions(authority, amountBase) {
  return [createAtaIdempotentIx(authority, authority), seedPoolIx(authority, amountBase)];
}
export function withdrawPoolInstructions(authority, amountBase) {
  return [createAtaIdempotentIx(authority, authority), withdrawPoolIx(authority, amountBase)];
}
export function setParamsInstructions(authority, params) {
  return [setParamsIx(authority, params)];
}
export function setPausedInstructions(authority, paused) {
  return [setPausedIx(authority, paused)];
}
export function liquidateInstructions(liquidator, targetOwner, swapPool) {
  return [createAtaIdempotentIx(liquidator, liquidator), liquidateIx(liquidator, targetOwner, swapPool)];
}

// ── on-chain readers ─────────────────────────────────────────────────────────
function viewOf(data) {
  return new DataView(data.buffer, data.byteOffset, data.byteLength);
}
function checkDisc(data, disc) {
  for (let i = 0; i < 8; i++) if (data[i] !== disc[i]) return false;
  return true;
}

/**
 * Read the Market account. Returns null if not initialized. Layout after the
 * 8-byte disc: authority[32] plsx_mint[32] swap_pool[32] borrow_apr_bps(u64)
 * ltv_bps(u64) liq_threshold_bps(u64) liq_bonus_bps(u64) total_borrowed(u64)
 * paused(u8) bump(u8) plsx_vault_bump(u8) → 147 bytes total.
 */
export async function readMarket(conn) {
  const info = await conn.getAccountInfo(marketPda());
  if (!info || !info.data || info.data.length < 147 || !checkDisc(info.data, ACCT_DISC.Market)) return null;
  const d = info.data;
  const v = viewOf(d);
  return {
    authority: new PublicKey(d.subarray(8, 40)).toBase58(),
    plsxMint: new PublicKey(d.subarray(40, 72)).toBase58(),
    swapPool: new PublicKey(d.subarray(72, 104)).toBase58(),
    borrowAprBps: Number(v.getBigUint64(104, true)),
    ltvBps: Number(v.getBigUint64(112, true)),
    liqThresholdBps: Number(v.getBigUint64(120, true)),
    liqBonusBps: Number(v.getBigUint64(128, true)),
    totalBorrowed: v.getBigUint64(136, true),
    paused: d[144] !== 0,
    bump: d[145],
    plsxVaultBump: d[146],
  };
}

/**
 * Read a borrower's Position. Returns null if it doesn't exist. Layout after the
 * 8-byte disc: owner[32] collateral_lamports(u64) borrowed_plsx(u64)
 * last_accrual_ts(i64) bump(u8) → 65 bytes total.
 */
export async function readPosition(conn, owner) {
  const info = await conn.getAccountInfo(positionPda(owner));
  if (!info || !info.data || info.data.length < 65 || !checkDisc(info.data, ACCT_DISC.Position)) return null;
  const d = info.data;
  const v = viewOf(d);
  return {
    owner: new PublicKey(d.subarray(8, 40)).toBase58(),
    collateralLamports: v.getBigUint64(40, true),
    borrowedPlsx: v.getBigUint64(48, true),
    lastAccrualTs: Number(v.getBigInt64(56, true)),
    bump: d[64],
  };
}

/** PLSX balance (base units, BigInt) currently in the lending vault. 0n if absent. */
export async function readVaultBalance(conn) {
  try {
    const res = await conn.getTokenAccountBalance(plsxVaultPda());
    return BigInt(res.value.amount);
  } catch {
    return 0n;
  }
}

/** The oracle pool (our swap pool) — reserves used to price collateral. */
export async function readOraclePool(conn) {
  return readSwapPool(conn);
}

// ── risk math (mirrors the on-chain integer math EXACTLY, for display + preflight) ─
/** floor(a * b / d) in BigInt; 0n on a zero divisor. */
function mulDiv(a, b, d) {
  const A = BigInt(a || 0);
  const B = BigInt(b || 0);
  const D = BigInt(d || 0);
  if (D <= 0n) return 0n;
  return (A * B) / D;
}

/** Collateral value in PLSX base units, from the live oracle reserves. 0n if no liquidity. */
export function collateralValuePlsx(collateralLamports, pool) {
  if (!pool || pool.solReserve <= 0n || pool.tokenReserve <= 0n) return 0n;
  return mulDiv(collateralLamports, pool.tokenReserve, pool.solReserve);
}

/** Max PLSX borrow-able against a collateral value at the market LTV. */
export function borrowLimitPlsx(collateralValue, ltvBps) {
  return mulDiv(collateralValue, ltvBps, Number(BPS_DENOM));
}

/** Debt level (PLSX) at/above which the position becomes liquidatable. */
export function liquidationLinePlsx(collateralValue, liqThresholdBps) {
  return mulDiv(collateralValue, liqThresholdBps, Number(BPS_DENOM));
}

/** PLSX still available to borrow = max(0, limit - debt). */
export function availableToBorrow(collateralValue, ltvBps, debt) {
  const limit = borrowLimitPlsx(collateralValue, ltvBps);
  const d = BigInt(debt || 0);
  return limit > d ? limit - d : 0n;
}

/**
 * Debt including interest accrued since last settlement — the SAME linear formula
 * the program applies on the next interaction. For display so the borrower sees a
 * live figure, not a stale one. `nowSec` defaults to the wall clock.
 */
export function currentDebt(position, aprBps, nowSec = Math.floor(Date.now() / 1000)) {
  if (!position) return 0n;
  const borrowed = BigInt(position.borrowedPlsx || 0);
  const apr = BigInt(aprBps || 0);
  const dt = BigInt(Math.max(0, nowSec - (position.lastAccrualTs || 0)));
  if (borrowed <= 0n || apr <= 0n || dt <= 0n) return borrowed;
  const SECONDS_PER_YEAR = 31_536_000n;
  const interest = (borrowed * apr * dt) / BPS_DENOM / SECONDS_PER_YEAR;
  return borrowed + interest;
}

/**
 * Health factor = liquidation line / debt (Number, for display). >1 healthy,
 * <=1 liquidatable. null when there is no debt (nothing at risk).
 */
export function healthFactor(collateralValue, liqThresholdBps, debt) {
  const d = BigInt(debt || 0);
  if (d <= 0n) return null;
  const line = liquidationLinePlsx(collateralValue, liqThresholdBps);
  return Number(line) / Number(d);
}

// ── bps / percent display helpers ─────────────────────────────────────────────
/** bps (number) → percent string, e.g. 1000 → "10". */
export function pctFromBps(bps) {
  return (Number(bps || 0) / 100).toString();
}
/** percent input → bps BigInt, capped at `maxBps`. null on invalid input. */
export function bpsFromPct(percent, maxBps) {
  const p = Number(percent);
  if (!isFinite(p) || p < 0) return null;
  const bps = BigInt(Math.round(p * 100));
  return maxBps != null && bps > maxBps ? maxBps : bps;
}

export { DECIMALS };
