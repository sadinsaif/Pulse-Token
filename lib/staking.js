// ============================================================================
// PULSE (PLSX) staking — client for the REAL on-chain program (DEVNET).
// ----------------------------------------------------------------------------
// This talks to the Anchor program deployed at STAKING_PROGRAM_ID (see
// anchor/pulse_staking/src/lib.rs). It is a HAND-ROLLED client on top of plain
// @solana/web3.js — NO @coral-xyz/anchor, NO @solana/spl-token — so there is no
// Anchor-version / dependency fragility, and NOTHING new to install.
//
// HONESTY / SAFETY:
//  * Every value the UI shows is READ straight from chain (pool reward_rate,
//    total_staked, vault balances, the user's own staked/earned amounts). No
//    fabricated APY/TVL. Any APR figure is clearly an *estimate* derived from the
//    real on-chain reward_rate.
//  * This module NEVER holds a key. It only BUILDS unsigned instructions; the
//    user's wallet signs (see sendInstructions → wallet-adapter sendTransaction).
//  * Anchor discriminators are the first 8 bytes of sha256("global:<ix>") /
//    sha256("account:<Acct>"), computed here as constants — they match the
//    deployed program exactly (verified against its instruction/account names).
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
  STAKING_PROGRAM_ID as CFG_PROGRAM_ID,
  POOL_AUTHORITY as CFG_POOL_AUTHORITY,
  MINT_ADDRESS,
  DECIMALS,
} from "@/lib/config";

// ── Program-level constants ────────────────────────────────────────────────
export const PROGRAM_ID = new PublicKey(CFG_PROGRAM_ID);
export const MINT = new PublicKey(MINT_ADDRESS);
export const POOL_AUTHORITY = CFG_POOL_AUTHORITY; // base58 string (may be null)

// Well-known SPL program ids (hard-coded canonical values — never secrets).
export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

// Must match ACC_PRECISION in the Rust program (1e12) and one year in seconds.
export const ACC_PRECISION = 1_000_000_000_000n;
export const SECONDS_PER_YEAR = 31_536_000;

// Anchor 8-byte discriminators (sha256("global:name") / sha256("account:Name")).
const DISC = {
  initialize_pool: Uint8Array.from([95, 180, 10, 172, 84, 174, 232, 40]),
  set_reward_rate: Uint8Array.from([253, 201, 190, 20, 48, 38, 120, 34]),
  fund_rewards: Uint8Array.from([114, 64, 163, 112, 175, 167, 19, 121]),
  open_stake_account: Uint8Array.from([138, 47, 201, 7, 169, 98, 192, 243]),
  stake: Uint8Array.from([206, 176, 202, 18, 200, 209, 179, 108]),
  unstake: Uint8Array.from([90, 95, 107, 42, 205, 124, 50, 225]),
  claim: Uint8Array.from([62, 198, 214, 193, 213, 159, 108, 210]),
};
const ACCT_DISC = {
  Pool: Uint8Array.from([241, 154, 109, 4, 17, 177, 109, 188]),
  UserStake: Uint8Array.from([102, 53, 163, 107, 9, 138, 87, 153]),
};

// ── PDA derivations (mirror the Rust seeds exactly) ─────────────────────────
export function poolPda() {
  return PublicKey.findProgramAddressSync([Buffer.from("pool"), MINT.toBuffer()], PROGRAM_ID)[0];
}
export function stakeVaultPda(pool = poolPda()) {
  return PublicKey.findProgramAddressSync([Buffer.from("stake_vault"), pool.toBuffer()], PROGRAM_ID)[0];
}
export function rewardVaultPda(pool = poolPda()) {
  return PublicKey.findProgramAddressSync([Buffer.from("reward_vault"), pool.toBuffer()], PROGRAM_ID)[0];
}
export function userStakePda(owner, pool = poolPda()) {
  const o = owner instanceof PublicKey ? owner : new PublicKey(owner);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("user"), pool.toBuffer(), o.toBuffer()],
    PROGRAM_ID
  )[0];
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
export function initializePoolIx(authority, rewardRate) {
  const pool = poolPda();
  return ix(
    [
      key(authority, true, true), // authority (mut, signer)
      key(MINT, false, false), // mint
      key(pool, false, true), // pool (init)
      key(stakeVaultPda(pool), false, true), // stake_vault (init)
      key(rewardVaultPda(pool), false, true), // reward_vault (init)
      key(TOKEN_PROGRAM_ID, false, false),
      key(SystemProgram.programId, false, false),
      key(SYSVAR_RENT_PUBKEY, false, false),
    ],
    concatBytes(DISC.initialize_pool, u64le(rewardRate))
  );
}
export function setRewardRateIx(authority, newRate) {
  return ix(
    [key(authority, true, false), key(poolPda(), false, true)],
    concatBytes(DISC.set_reward_rate, u64le(newRate))
  );
}
export function fundRewardsIx(authority, amountBase) {
  const pool = poolPda();
  return ix(
    [
      key(authority, true, false), // authority (signer)
      key(pool, false, false), // pool
      key(rewardVaultPda(pool), false, true), // reward_vault (mut)
      key(ataFor(authority), false, true), // authority_token (mut)
      key(TOKEN_PROGRAM_ID, false, false),
    ],
    concatBytes(DISC.fund_rewards, u64le(amountBase))
  );
}
export function openStakeAccountIx(owner) {
  const pool = poolPda();
  return ix(
    [
      key(owner, true, true), // owner (mut, signer)
      key(pool, false, false), // pool
      key(userStakePda(owner, pool), false, true), // user_stake (init)
      key(SystemProgram.programId, false, false),
    ],
    concatBytes(DISC.open_stake_account)
  );
}
export function stakeIx(owner, amountBase) {
  const pool = poolPda();
  return ix(
    [
      key(owner, true, true),
      key(pool, false, true),
      key(userStakePda(owner, pool), false, true),
      key(stakeVaultPda(pool), false, true),
      key(ataFor(owner), false, true), // owner_token
      key(TOKEN_PROGRAM_ID, false, false),
    ],
    concatBytes(DISC.stake, u64le(amountBase))
  );
}
export function unstakeIx(owner, amountBase) {
  const pool = poolPda();
  return ix(
    [
      key(owner, true, true),
      key(pool, false, true),
      key(userStakePda(owner, pool), false, true),
      key(stakeVaultPda(pool), false, true),
      key(ataFor(owner), false, true),
      key(TOKEN_PROGRAM_ID, false, false),
    ],
    concatBytes(DISC.unstake, u64le(amountBase))
  );
}
export function claimIx(owner) {
  const pool = poolPda();
  return ix(
    [
      key(owner, true, true),
      key(pool, false, false),
      key(userStakePda(owner, pool), false, true),
      key(rewardVaultPda(pool), false, true),
      key(ataFor(owner), false, true),
      key(TOKEN_PROGRAM_ID, false, false),
    ],
    concatBytes(DISC.claim)
  );
}

// ── high-level instruction assemblers (async: they check on-chain state) ─────
/** Stake: ensure the owner ATA + UserStake PDA exist, then stake. */
export async function stakeInstructions(conn, owner, amountBase) {
  const ixs = [createAtaIdempotentIx(owner, owner)];
  if (!(await userStakeExists(conn, owner))) ixs.push(openStakeAccountIx(owner));
  ixs.push(stakeIx(owner, amountBase));
  return ixs;
}
export function unstakeInstructions(owner, amountBase) {
  return [createAtaIdempotentIx(owner, owner), unstakeIx(owner, amountBase)];
}
export function claimInstructions(owner) {
  return [createAtaIdempotentIx(owner, owner), claimIx(owner)];
}
export function initializePoolInstructions(authority, rewardRate) {
  return [initializePoolIx(authority, rewardRate)];
}
export function fundRewardsInstructions(authority, amountBase) {
  return [createAtaIdempotentIx(authority, authority), fundRewardsIx(authority, amountBase)];
}
export function setRewardRateInstructions(authority, newRate) {
  return [setRewardRateIx(authority, newRate)];
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

/** Read the Pool account. Returns null if the pool isn't initialized yet. */
export async function readPool(conn) {
  const info = await conn.getAccountInfo(poolPda());
  if (!info || !info.data || info.data.length < 91 || !checkDisc(info.data, ACCT_DISC.Pool)) return null;
  const d = info.data;
  const v = viewOf(d);
  return {
    mint: new PublicKey(d.subarray(8, 40)).toBase58(),
    authority: new PublicKey(d.subarray(40, 72)).toBase58(),
    rewardRate: v.getBigUint64(72, true),
    totalStaked: v.getBigUint64(80, true),
    bump: d[88],
    stakeVaultBump: d[89],
    rewardVaultBump: d[90],
  };
}

/** Read a user's UserStake account. Returns null if they've never opened one. */
export async function readUserStake(conn, owner) {
  const info = await conn.getAccountInfo(userStakePda(owner));
  if (!info || !info.data || info.data.length < 65 || !checkDisc(info.data, ACCT_DISC.UserStake)) return null;
  const d = info.data;
  const v = viewOf(d);
  return {
    owner: new PublicKey(d.subarray(8, 40)).toBase58(),
    amount: v.getBigUint64(40, true),
    pending: v.getBigUint64(48, true),
    lastUpdate: v.getBigInt64(56, true),
    bump: d[64],
  };
}

export async function userStakeExists(conn, owner) {
  const info = await conn.getAccountInfo(userStakePda(owner));
  return Boolean(info);
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
export function readStakeVaultBalance(conn) {
  return tokenAccountBalance(conn, stakeVaultPda());
}
export function readRewardVaultBalance(conn) {
  return tokenAccountBalance(conn, rewardVaultPda());
}

// ── amount / rate helpers ─────────────────────────────────────────────────────
/** Human decimal string → base-unit BigInt. Returns null on invalid input. */
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

/** Scaled reward_rate (u64) → estimated APR percent (Number, for display only). */
export function aprPercentFromRate(rewardRate) {
  const r = typeof rewardRate === "bigint" ? Number(rewardRate) : Number(rewardRate || 0);
  return (r * SECONDS_PER_YEAR) / Number(ACC_PRECISION) * 100;
}

/** Target APR percent → scaled reward_rate (BigInt u64) for initialize/set_rate. */
export function rateFromAprPercent(aprPercent) {
  const apr = Number(aprPercent);
  if (!isFinite(apr) || apr < 0) return null;
  const scaled = (apr / 100) * Number(ACC_PRECISION) / SECONDS_PER_YEAR;
  return BigInt(Math.round(scaled));
}

/**
 * Live "claimable" estimate = on-chain pending + accrual since last_update, using
 * the SAME formula the program's settle() uses. This is not fabricated — it is
 * the real on-chain state projected to now; the actual claim settles on-chain.
 */
export function estimateClaimable(user, rewardRate, nowSeconds) {
  if (!user) return 0n;
  let pending = user.pending;
  const elapsed = BigInt(Math.max(0, Math.floor(nowSeconds) - Number(user.lastUpdate)));
  const rate = typeof rewardRate === "bigint" ? rewardRate : BigInt(rewardRate || 0);
  if (elapsed > 0n && user.amount > 0n && rate > 0n) {
    pending += (user.amount * rate * elapsed) / ACC_PRECISION;
  }
  return pending;
}
