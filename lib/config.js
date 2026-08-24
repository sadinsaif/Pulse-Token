// ============================================================================
// PULSE (PLSX) — single source of truth for token identity + network.
// ============================================================================
//
// The PROJECT is "PULSE" (brand/name). The TOKEN TICKER is "PLSX". Correct
// end state everywhere: "PULSE — PLSX" (project = PULSE, token = PLSX).
//
// WHY this lives here and NOT in env: the deployed Vercel environment still
// sets NEXT_PUBLIC_TOKEN_SYMBOL=PULSE. If the displayed ticker were read from
// env it would silently revert PLSX → PULSE on the live site. So the *display*
// ticker is fixed in code here; lib/solana.js imports it as the default.
// Mint / decimals / network stay overridable via NEXT_PUBLIC_* (with these as
// defaults) for the eventual, deliberate mainnet flip.
//
// HONESTY RULES baked in: no fake mainnet address (MAINNET_MINT_ADDRESS = null),
// no invented socials/docs (SOCIALS / DOCS = null → the UI shows "Coming Soon").
// Nothing here implies monetary value on Devnet.

export const PROJECT_NAME = "PULSE";
export const TOKEN_SYMBOL = "PLSX";

export const NETWORK_LABEL = "Solana Devnet"; // human-readable, for display
export const NETWORK_ID = "devnet"; // "devnet" | "mainnet-beta" | "testnet"

// The existing, already-minted Devnet token. Do NOT change this.
export const MINT_ADDRESS = "tGudK5nqi3Q2Fpy2BYdezdEHZcX43ptbePyttUDJq5m";

// No mainnet token exists yet — keep this null so the UI never fabricates one.
export const MAINNET_MINT_ADDRESS = null;

export const DECIMALS = 9;
export const TOTAL_SUPPLY = "1,000,000,000"; // intended fixed supply, as a fact

// Solana Explorer, transfers tab, pinned to the devnet cluster.
export const EXPLORER_TRANSFERS =
  "https://explorer.solana.com/address/tGudK5nqi3Q2Fpy2BYdezdEHZcX43ptbePyttUDJq5m/transfers?cluster=devnet";

// Derived: true only once a real mainnet mint is set above.
export const IS_MAINNET_LIVE = MAINNET_MINT_ADDRESS !== null; // false

// Not published yet → the UI renders "Coming Soon" instead of fake links.
export const SOCIALS = null;
export const DOCS = null;

// ── Staking (DEVNET only) ───────────────────────────────────────────────────
// The REAL Anchor staking program deployed via Solana Playground (see
// anchor/pulse_staking/src/lib.rs + docs/STAKING_DEPLOY.md). These are PUBLIC
// on-chain identifiers — never secrets:
//   • STAKING_PROGRAM_ID — the deployed program's address (devnet).
//   • POOL_AUTHORITY      — the wallet that initializes/funds the pool. The site
//     shows the admin panel (Initialize / Fund) ONLY to this exact pubkey; it is
//     a normal wallet address, and every admin action is signed by that wallet.
// Staking stays gated behind DEVNET_CONFIG.features.stake (still false) until the
// pool is deployed, funded, AND verified on-chain — nothing fake ships.
export const STAKING_PROGRAM_ID = "52J8CjmJgjpiweAR6dbnCEf2dmfjNZbPhN1VBvMHzCY8";
export const POOL_AUTHORITY = "hU7g65F7jkyryGGWXSYTE4SY6k94NeQYfnYkveuSvvN";
