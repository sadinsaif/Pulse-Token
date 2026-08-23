// Shared Solana config + READ-ONLY helpers for the standalone $PULSE site.
//
// This site only ever READS the chain (wallet connect + on-chain balance) — it
// never links a wallet or submits a transaction, so signing / claim-input helpers
// (buildWalletLinkMessage, parseTokens) are intentionally left out here.
//
// Network-configurable by design (devnet first; mainnet is an env flip): every
// endpoint/cluster/mint value comes from NEXT_PUBLIC_* env, nothing is hard-coded.
// Balance reads use only @solana/web3.js (the parsed token-accounts call is a
// Connection method), so this module is light enough to import from client
// components directly.
//
// MONEY UNITS: token amounts are handled in BASE UNITS as BigInt. The mint has 9
// decimals, so a 1,000,000,000-supply token is 1e18 base units — that exceeds JS
// Number's safe integer range (2^53), so we never coerce a base-unit amount to
// Number. formatTokens converts only at the UI edge.

import { Connection, PublicKey } from "@solana/web3.js";
import {
  TOKEN_SYMBOL as CONFIG_SYMBOL,
  DECIMALS as CONFIG_DECIMALS,
  MINT_ADDRESS as CONFIG_MINT,
  NETWORK_ID as CONFIG_NETWORK,
} from "@/lib/config";

// "devnet" | "mainnet-beta" | "testnet". Drives the default RPC + explorer cluster.
export const NETWORK = process.env.NEXT_PUBLIC_SOLANA_NETWORK || CONFIG_NETWORK;

// DISPLAY TICKER comes from config, NOT env, on purpose: the live Vercel env
// still sets NEXT_PUBLIC_TOKEN_SYMBOL=PULSE, which would otherwise revert the
// ticker back from PLSX. See lib/config.js for the full rationale.
export const TOKEN_SYMBOL = CONFIG_SYMBOL;

export const TOKEN_DECIMALS = Number(process.env.NEXT_PUBLIC_TOKEN_DECIMALS || CONFIG_DECIMALS);
// Defaults to the already-minted devnet mint; env can still override for mainnet.
export const TOKEN_MINT = process.env.NEXT_PUBLIC_TOKEN_MINT || CONFIG_MINT;

const PUBLIC_RPC = {
  "mainnet-beta": "https://api.mainnet-beta.solana.com",
  testnet: "https://api.testnet.solana.com",
  devnet: "https://api.devnet.solana.com",
};

/** The RPC endpoint: an explicit override, else the public cluster URL. */
export function getRpcEndpoint() {
  return process.env.NEXT_PUBLIC_SOLANA_RPC || PUBLIC_RPC[NETWORK] || PUBLIC_RPC.devnet;
}

let _conn = null;
/** A shared read Connection ('confirmed' commitment). */
export function getConnection() {
  if (!_conn) _conn = new Connection(getRpcEndpoint(), "confirmed");
  return _conn;
}

/** True when the token has been deployed and wired into env. */
export function isTokenConfigured() {
  return Boolean(TOKEN_MINT);
}

/** Validate a base58 Solana address without throwing. */
export function isValidSolAddress(value) {
  try {
    // eslint-disable-next-line no-new
    new PublicKey(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Total $PULSE held by an owner, in BASE UNITS (BigInt). Sums ALL of the owner's
 * token accounts for the mint (not just the ATA) so a wallet's holdings are
 * counted in full. Returns 0n when the token isn't configured or the address is
 * invalid. Never throws for "no account" — a wallet with none simply holds 0.
 */
export async function getSplBalanceBase(ownerAddress) {
  if (!TOKEN_MINT || !isValidSolAddress(ownerAddress)) return 0n;
  const conn = getConnection();
  const res = await conn.getParsedTokenAccountsByOwner(new PublicKey(ownerAddress), {
    mint: new PublicKey(TOKEN_MINT),
  });
  let total = 0n;
  for (const { account } of res.value) {
    const amt = account?.data?.parsed?.info?.tokenAmount?.amount;
    if (amt) total += BigInt(amt);
  }
  return total;
}

/**
 * BigInt base units → a plain decimal string (no thousands separators), trailing
 * zeros trimmed. e.g. 1500000000n @ 9 decimals → "1.5".
 */
export function formatTokens(baseUnits, decimals = TOKEN_DECIMALS) {
  const b = typeof baseUnits === "bigint" ? baseUnits : BigInt(baseUnits || 0);
  const neg = b < 0n;
  const digits = (neg ? -b : b).toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const frac = digits.slice(digits.length - decimals).replace(/0+$/, "");
  const out = frac ? `${whole}.${frac}` : whole;
  return neg ? `-${out}` : out;
}

/** Like formatTokens but with grouped thousands on the whole part (for display). */
export function formatTokensPretty(baseUnits, decimals = TOKEN_DECIMALS) {
  const s = formatTokens(baseUnits, decimals);
  const neg = s.startsWith("-");
  const [whole, frac] = (neg ? s.slice(1) : s).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const out = frac ? `${grouped}.${frac}` : grouped;
  return neg ? `-${out}` : out;
}

/** Solana Explorer URL for an address/tx, carrying the non-mainnet cluster query. */
export function explorerUrl(value, kind = "address") {
  const suffix = NETWORK === "mainnet-beta" ? "" : `?cluster=${encodeURIComponent(NETWORK)}`;
  return `https://explorer.solana.com/${kind}/${value}${suffix}`;
}

/** Short "abcd…wxyz" form of a long address, for compact display. */
export function shortAddress(value, lead = 4, tail = 4) {
  if (!value || value.length <= lead + tail + 1) return value || "";
  return `${value.slice(0, lead)}…${value.slice(-tail)}`;
}

// ============================================================================
// NETWORK-AWARE VARIANTS (for the multi-network ecosystem: devnet/testnet).
// ----------------------------------------------------------------------------
// The exports above are the original Devnet-default helpers and stay unchanged
// so the existing landing keeps working. The variants below take an explicit
// Connection / mint / cluster, so a caller can read whichever network the user
// has selected — without touching the module-level singleton. They are still
// READ-ONLY except requestAirdropFor, which is a real, keyless test-SOL faucet
// (no private key, no signing) available on devnet/testnet only.
// ============================================================================

const LAMPORTS_PER_SOL = 1_000_000_000;

// One Connection per RPC url, cached — avoids rebuilding on every render/read.
const _connCache = new Map();
/** A shared read Connection for an arbitrary RPC endpoint ('confirmed'). */
export function connectionFor(rpc) {
  if (!rpc) return getConnection();
  let c = _connCache.get(rpc);
  if (!c) {
    c = new Connection(rpc, "confirmed");
    _connCache.set(rpc, c);
  }
  return c;
}

/** Native SOL balance of an owner, in lamports (Number). 0 on invalid input. */
export async function getSolBalanceFor(conn, ownerAddress) {
  if (!conn || !isValidSolAddress(ownerAddress)) return 0;
  return conn.getBalance(new PublicKey(ownerAddress));
}

/** lamports (number|bigint) → SOL display string, trailing zeros trimmed. */
export function formatLamports(lamports, maxFractionDigits = 4) {
  const n = typeof lamports === "bigint" ? Number(lamports) : Number(lamports || 0);
  const sol = n / LAMPORTS_PER_SOL;
  const s = sol.toFixed(maxFractionDigits);
  return s.replace(/\.?0+$/, "") || "0";
}

/**
 * Token balance (BASE UNITS, BigInt) for an owner on a given connection + mint.
 * Network-aware form of getSplBalanceBase. Returns 0n when mint is null (e.g.
 * testnet/mainnet have no PLSX yet) or the address is invalid — never throws
 * for "no account".
 */
export async function getSplBalanceBaseFor(conn, mint, ownerAddress) {
  if (!conn || !mint || !isValidSolAddress(ownerAddress) || !isValidSolAddress(mint)) return 0n;
  const res = await conn.getParsedTokenAccountsByOwner(new PublicKey(ownerAddress), {
    mint: new PublicKey(mint),
  });
  let total = 0n;
  for (const { account } of res.value) {
    const amt = account?.data?.parsed?.info?.tokenAmount?.amount;
    if (amt) total += BigInt(amt);
  }
  return total;
}

/** LIVE mint status on a given connection + mint. Same shape as getMintStatus. */
export async function getMintStatusFor(conn, mint) {
  if (!conn || !mint || !isValidSolAddress(mint)) return null;
  const res = await conn.getParsedAccountInfo(new PublicKey(mint));
  const info = res?.value?.data?.parsed?.info;
  if (!info || res.value?.data?.parsed?.type !== "mint") return null;
  return {
    supply: info.supply != null ? BigInt(info.supply) : null,
    decimals: typeof info.decimals === "number" ? info.decimals : TOKEN_DECIMALS,
    mintAuthority: info.mintAuthority ?? null,
    freezeAuthority: info.freezeAuthority ?? null,
    initialized: Boolean(info.isInitialized),
  };
}

/** Explorer URL for an explicit cluster (mainnet-beta → no ?cluster suffix). */
export function explorerUrlFor(cluster, value, kind = "address") {
  const suffix = cluster === "mainnet-beta" ? "" : `?cluster=${encodeURIComponent(cluster)}`;
  return `https://explorer.solana.com/${kind}/${value}${suffix}`;
}

/**
 * REAL, keyless test-SOL faucet. Calls the RPC's requestAirdrop for the given
 * owner and waits for confirmation. No private key, no wallet signature — the
 * cluster funds the wallet directly. Only meaningful on devnet/testnet; the
 * public faucet is rate-limited and can fail, so callers MUST surface the real
 * error and never fake success. Returns the tx signature on success; throws otherwise.
 */
export async function requestAirdropFor(conn, ownerAddress, lamports = LAMPORTS_PER_SOL) {
  if (!conn) throw new Error("No connection.");
  if (!isValidSolAddress(ownerAddress)) throw new Error("Invalid wallet address.");
  const owner = new PublicKey(ownerAddress);
  const latest = await conn.getLatestBlockhash();
  const signature = await conn.requestAirdrop(owner, lamports);
  await conn.confirmTransaction(
    { signature, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
    "confirmed"
  );
  return signature;
}

export { LAMPORTS_PER_SOL };

/**
 * LIVE on-chain status of the mint account — the honest basis for the
 * Security & Transparency section. Uses only getParsedAccountInfo (a Connection
 * method in @solana/web3.js), so no extra deps. Returns real values straight
 * from chain; we never fake a "revoked authority" / audit checkmark.
 *
 *   supply         BigInt base units (9 decimals) — never coerced to Number
 *   decimals       number
 *   mintAuthority  base58 string | null  (null == mint authority revoked)
 *   freezeAuthority base58 string | null (null == freeze authority revoked)
 *   initialized    boolean
 *
 * Returns null if the mint isn't configured or the account can't be read as a
 * SPL mint — the caller renders an explicit error/pending state, not fake data.
 */
export async function getMintStatus(mintAddress = TOKEN_MINT) {
  if (!mintAddress || !isValidSolAddress(mintAddress)) return null;
  const conn = getConnection();
  const res = await conn.getParsedAccountInfo(new PublicKey(mintAddress));
  const info = res?.value?.data?.parsed?.info;
  if (!info || res.value?.data?.parsed?.type !== "mint") return null;
  return {
    supply: info.supply != null ? BigInt(info.supply) : null,
    decimals: typeof info.decimals === "number" ? info.decimals : TOKEN_DECIMALS,
    mintAuthority: info.mintAuthority ?? null,
    freezeAuthority: info.freezeAuthority ?? null,
    initialized: Boolean(info.isInitialized),
  };
}
