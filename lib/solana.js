// Shared Solana config + READ-ONLY helpers for the standalone $PULSE site.
//
// This is a trimmed copy of the main PulseFy app's lib/solana.js. This site only
// ever READS the chain (wallet connect + on-chain balance) — it never links a
// wallet or submits a claim (those deep-link into the main app), so the signing /
// claim-input helpers (buildWalletLinkMessage, parseTokens) are intentionally left
// out here.
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

// "devnet" | "mainnet-beta" | "testnet". Drives the default RPC + explorer cluster.
export const NETWORK = process.env.NEXT_PUBLIC_SOLANA_NETWORK || "devnet";
export const TOKEN_SYMBOL = process.env.NEXT_PUBLIC_TOKEN_SYMBOL || "PULSE";
export const TOKEN_DECIMALS = Number(process.env.NEXT_PUBLIC_TOKEN_DECIMALS || 9);
// Empty until the mint has been created and pasted into env.
export const TOKEN_MINT = process.env.NEXT_PUBLIC_TOKEN_MINT || "";

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
