// ============================================================================
// PULSE (PLSX) swap — client for the REAL on-chain AMM (DEVNET).
// ----------------------------------------------------------------------------
// This talks to the Anchor program deployed at SWAP_PROGRAM_ID (see
// anchor/pulse_swap/src/lib.rs). It is a HAND-ROLLED client on top of plain
// @solana/web3.js — NO @coral-xyz/anchor, NO @solana/spl-token, NO IDL — so
// there is no Anchor-version / dependency fragility, and NOTHING new to install.
//
// The pool is a constant-product (x·y=k) AMM for PLSX <-> native SOL:
//   • SOL reserve = native lamports held in the Pool config PDA (program-owned).
//   • PLSX reserve = a PDA-owned SPL token vault.
//   • Only the authority seeds/withdraws liquidity (add/remove). Users only swap.
//
// HONESTY / SAFETY:
//  * Every value the UI shows is READ straight from chain (pool reserves, fee).
//    Quotes are the exact constant-product output computed from the REAL reserves;
//    there is no fabricated price/TVL. An empty/uninitialized pool yields a 0
//    quote and the UI shows an honest "no liquidity yet" — never a fake number.
//  * This module NEVER holds a key. It only BUILDS unsigned instructions; the
//    user's wallet signs (see sendInstructions → wallet-adapter sendTransaction).
//  * Anchor discriminators are the first 8 bytes of sha256("global:<ix>") /
//    sha256("account:<Acct>"), pinned here as constants — they match the deployed
//    program exactly (verified against its instruction/account names on-chain).
// ============================================================================

import { Buffer } from "buffer";
import {
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import {
  SWAP_PROGRAM_ID as CFG_PROGRAM_ID,
  SWAP_AUTHORITY as CFG_SWAP_AUTHORITY,
  MINT_ADDRESS,
  DECIMALS,
} from "@/lib/config";

// ── Program-level constants ────────────────────────────────────────────────
export const PROGRAM_ID = new PublicKey(CFG_PROGRAM_ID);
export const MINT = new PublicKey(MINT_ADDRESS);
export const SWAP_AUTHORITY = CFG_SWAP_AUTHORITY; // base58 string

// Well-known SPL program ids (hard-coded canonical values — never secrets).
export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

// Must match the Rust program: fee_bps is out of 10_000, capped at 10%.
export const FEE_DENOM = 10_000n;
export const MAX_FEE_BPS = 1_000n;

// Anchor 8-byte discriminators (sha256("global:name") / sha256("account:Name")).
const DISC = {
  initialize_pool: Uint8Array.from([95, 180, 10, 172, 84, 174, 232, 40]),
  set_fee_bps: Uint8Array.from([2, 161, 245, 141, 111, 32, 39, 198]),
  add_liquidity: Uint8Array.from([181, 157, 89, 67, 143, 182, 52, 72]),
  remove_liquidity: Uint8Array.from([80, 85, 209, 72, 24, 206, 177, 108]),
  swap_sol_for_token: Uint8Array.from([241, 106, 222, 44, 89, 254, 233, 161]),
  swap_token_for_sol: Uint8Array.from([253, 34, 238, 50, 70, 172, 220, 33]),
};
const ACCT_DISC = {
  Pool: Uint8Array.from([241, 154, 109, 4, 17, 177, 109, 188]),
};

// ── PDA derivations (mirror the Rust seeds exactly) ─────────────────────────
export function poolPda() {
  return PublicKey.findProgramAddressSync([Buffer.from("swap_pool"), MINT.toBuffer()], PROGRAM_ID)[0];
}
export function tokenVaultPda(pool = poolPda()) {
  return PublicKey.findProgramAddressSync([Buffer.from("token_vault"), pool.toBuffer()], PROGRAM_ID)[0];
}
/** Associated Token Account for (owner, PLSX mint) — derived, no spl-token dep. */
export function ataFor(owner) {
  const o = owner instanceof PublicKey ? owner : new PublicKey(owner);
  return PublicKey.findProgramAddressSync(
    [o.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), MINT.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0];
}

// ── encoding helpers ────────────────────────────────────────────────────────
function u64le(value) {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(value), true); // little-endian
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

/** Idempotent create of an ATA (no spl-token dep). No-op if it already exists. */
export function createAtaIdempotentIx(payer, owner, ataAddress = ataFor(owner)) {
  const o = owner instanceof PublicKey ? owner : new PublicKey(owner);
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      key(payer, true, true), // payer
      key(ataAddress, false, true), // ata
      key(o, false, false), // owner
      key(MINT, false, false), // mint
      key(SystemProgram.programId, false, false),
      key(TOKEN_PROGRAM_ID, false, false),
    ],
    data: Buffer.from([1]), // 1 = CreateIdempotent
  });
}

// ── instruction builders (account order MUST match the Rust #[derive(Accounts)]) ─
export function initializePoolIx(authority, feeBps) {
  const pool = poolPda();
  return ix(
    [
      key(authority, true, true), // authority (mut, signer)
      key(MINT, false, false), // mint
      key(pool, false, true), // pool (init)
      key(tokenVaultPda(pool), false, true), // token_vault (init)
      key(TOKEN_PROGRAM_ID, false, false),
      key(SystemProgram.programId, false, false),
      key(SYSVAR_RENT_PUBKEY, false, false),
    ],
    concatBytes(DISC.initialize_pool, u64le(feeBps))
  );
}
export function setFeeBpsIx(authority, feeBps) {
  return ix(
    [key(authority, true, false), key(poolPda(), false, true)],
    concatBytes(DISC.set_fee_bps, u64le(feeBps))
  );
}
export function addLiquidityIx(authority, tokenAmountBase, solAmountLamports) {
  const pool = poolPda();
  return ix(
    [
      key(authority, true, true), // authority (mut, signer)
      key(pool, false, true), // pool (mut)
      key(tokenVaultPda(pool), false, true), // token_vault (mut)
      key(ataFor(authority), false, true), // authority_token (mut)
      key(TOKEN_PROGRAM_ID, false, false),
      key(SystemProgram.programId, false, false),
    ],
    concatBytes(DISC.add_liquidity, u64le(tokenAmountBase), u64le(solAmountLamports))
  );
}
export function removeLiquidityIx(authority, tokenAmountBase, solAmountLamports) {
  const pool = poolPda();
  return ix(
    [
      key(authority, true, true), // authority (mut, signer)
      key(pool, false, true), // pool (mut)
      key(tokenVaultPda(pool), false, true), // token_vault (mut)
      key(ataFor(authority), false, true), // authority_token (mut)
      key(TOKEN_PROGRAM_ID, false, false),
    ],
    concatBytes(DISC.remove_liquidity, u64le(tokenAmountBase), u64le(solAmountLamports))
  );
}
export function swapSolForTokenIx(user, solInLamports, minTokenOutBase) {
  const pool = poolPda();
  return ix(
    [
      key(user, true, true), // user (mut, signer)
      key(pool, false, true), // pool (mut)
      key(tokenVaultPda(pool), false, true), // token_vault (mut)
      key(ataFor(user), false, true), // user_token (mut)
      key(TOKEN_PROGRAM_ID, false, false),
      key(SystemProgram.programId, false, false),
    ],
    concatBytes(DISC.swap_sol_for_token, u64le(solInLamports), u64le(minTokenOutBase))
  );
}
export function swapTokenForSolIx(user, tokenInBase, minSolOutLamports) {
  const pool = poolPda();
  return ix(
    [
      key(user, true, true), // user (mut, signer)
      key(pool, false, true), // pool (mut)
      key(tokenVaultPda(pool), false, true), // token_vault (mut)
      key(ataFor(user), false, true), // user_token (mut)
      key(TOKEN_PROGRAM_ID, false, false),
    ],
    concatBytes(DISC.swap_token_for_sol, u64le(tokenInBase), u64le(minSolOutLamports))
  );
}

// ── high-level instruction assemblers ─────────────────────────────────────────
// Swaps prepend an idempotent create of the user's PLSX ATA: a first-time buyer
// (SOL→PLSX) has no PLSX token account yet, and CreateIdempotent is a no-op when
// it already exists (PLSX→SOL sellers).
export function swapSolForTokenInstructions(user, solInLamports, minTokenOutBase) {
  return [createAtaIdempotentIx(user, user), swapSolForTokenIx(user, solInLamports, minTokenOutBase)];
}
export function swapTokenForSolInstructions(user, tokenInBase, minSolOutLamports) {
  return [createAtaIdempotentIx(user, user), swapTokenForSolIx(user, tokenInBase, minSolOutLamports)];
}
export function initializePoolInstructions(authority, feeBps) {
  return [initializePoolIx(authority, feeBps)];
}
export function addLiquidityInstructions(authority, tokenAmountBase, solAmountLamports) {
  return [createAtaIdempotentIx(authority, authority), addLiquidityIx(authority, tokenAmountBase, solAmountLamports)];
}
export function removeLiquidityInstructions(authority, tokenAmountBase, solAmountLamports) {
  return [createAtaIdempotentIx(authority, authority), removeLiquidityIx(authority, tokenAmountBase, solAmountLamports)];
}
export function setFeeBpsInstructions(authority, feeBps) {
  return [setFeeBpsIx(authority, feeBps)];
}

/**
 * Assemble ixs into a tx, have the WALLET sign+send, and confirm. The caller
 * passes the wallet-adapter's sendTransaction — no key is ever handled here.
 */
export async function sendInstructions({ conn, ixs, publicKey, sendTransaction }) {
  const tx = new Transaction().add(...ixs);
  tx.feePayer = publicKey;
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  const signature = await sendTransaction(tx, conn);
  await conn.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
  return signature;
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
 * Read the Pool account. Returns null if the pool isn't initialized yet.
 * Layout (after the 8-byte disc): mint[32] authority[32] fee_bps(u16)
 * token_reserve(u64) sol_reserve(u64) bump(u8) token_vault_bump(u8) → 84 bytes.
 */
export async function readPool(conn) {
  const info = await conn.getAccountInfo(poolPda());
  if (!info || !info.data || info.data.length < 92 || !checkDisc(info.data, ACCT_DISC.Pool)) return null;
  const d = info.data;
  const v = viewOf(d);
  return {
    mint: new PublicKey(d.subarray(8, 40)).toBase58(),
    authority: new PublicKey(d.subarray(40, 72)).toBase58(),
    feeBps: v.getUint16(72, true),
    tokenReserve: v.getBigUint64(74, true), // PLSX base units
    solReserve: v.getBigUint64(82, true), // lamports
    bump: d[90],
    tokenVaultBump: d[91],
  };
}

/** SPL token-account balance (base units, BigInt). 0n if the account is absent. */
export async function tokenAccountBalance(conn, tokenAccount) {
  try {
    const res = await conn.getTokenAccountBalance(tokenAccount);
    return BigInt(res.value.amount);
  } catch {
    return 0n;
  }
}
export function readTokenVaultBalance(conn) {
  return tokenAccountBalance(conn, tokenVaultPda());
}

// ── amount / quote helpers ────────────────────────────────────────────────────
/**
 * Human decimal string → base-unit BigInt. Returns null on invalid input. PLSX
 * and SOL both use 9 decimals here, so this converts SOL → lamports too.
 */
export function parseAmountToBase(input, decimals = DECIMALS) {
  const s = String(input ?? "").trim();
  if (!s || s === "." || !/^\d*\.?\d*$/.test(s)) return null;
  const [whole = "0", frac = ""] = s.split(".");
  if (frac.length > decimals) return null;
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  try {
    return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(fracPadded || "0");
  } catch {
    return null;
  }
}

/**
 * Constant-product output for `amountIn` given the reserves — the EXACT integer
 * math the on-chain program uses (fee taken on input). Returns 0n if any input is
 * non-positive (e.g. an empty pool), so callers render an honest zero/"no
 * liquidity", never a fabricated price.
 */
export function quoteOut(amountIn, reserveIn, reserveOut, feeBps) {
  const aIn = BigInt(amountIn || 0);
  const rIn = BigInt(reserveIn || 0);
  const rOut = BigInt(reserveOut || 0);
  const fee = BigInt(feeBps || 0);
  if (aIn <= 0n || rIn <= 0n || rOut <= 0n) return 0n;
  const inAfterFee = (aIn * (FEE_DENOM - fee)) / FEE_DENOM;
  if (inAfterFee <= 0n) return 0n;
  return (rOut * inAfterFee) / (rIn + inAfterFee);
}

/** SOL (lamports) → PLSX (base units) quote from the live reserves. */
export function quoteSolForToken(pool, solInLamports) {
  if (!pool) return 0n;
  return quoteOut(solInLamports, pool.solReserve, pool.tokenReserve, pool.feeBps);
}
/** PLSX (base units) → SOL (lamports) quote from the live reserves. */
export function quoteTokenForSol(pool, tokenInBase) {
  if (!pool) return 0n;
  return quoteOut(tokenInBase, pool.tokenReserve, pool.solReserve, pool.feeBps);
}

/** out (BigInt) → min_out after a slippage tolerance (bps). Floors, never negative. */
export function applySlippage(out, slippageBps) {
  const o = BigInt(out || 0);
  const s = BigInt(slippageBps || 0);
  if (o <= 0n) return 0n;
  const capped = s > FEE_DENOM ? FEE_DENOM : s;
  return (o * (FEE_DENOM - capped)) / FEE_DENOM;
}

// ── fee display helpers ────────────────────────────────────────────────────────
/** fee_bps (number) → percent string, e.g. 30 → "0.3". */
export function feePercentFromBps(feeBps) {
  return (Number(feeBps || 0) / 100).toString();
}
/** percent input → fee_bps BigInt (capped at MAX_FEE_BPS). null on invalid input. */
export function feeBpsFromPercent(percent) {
  const p = Number(percent);
  if (!isFinite(p) || p < 0) return null;
  const bps = BigInt(Math.round(p * 100));
  return bps > MAX_FEE_BPS ? MAX_FEE_BPS : bps;
}

/**
 * Display price: PLSX per 1 SOL, from the reserves (Number, for display only).
 * Both reserves are 9-decimal base units, so the ratio is already in whole
 * PLSX-per-SOL. Returns null when the pool has no liquidity.
 */
export function plsxPerSol(pool) {
  if (!pool || pool.solReserve <= 0n || pool.tokenReserve <= 0n) return null;
  return Number(pool.tokenReserve) / Number(pool.solReserve);
}
