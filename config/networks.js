// ============================================================================
// PULSE (PLSX) — multi-network source of truth: DEVNET → TESTNET → MAINNET.
// ============================================================================
//
// One config object per Solana network. This is the ONLY place that decides
// which cluster/RPC/mint/features are available where. Everything network-aware
// (the selector, the dashboard, balance/security reads, explorer links) reads
// from here so there is never a second, drifting definition.
//
// HONESTY / SAFETY rules baked into the data itself (not just prose):
//   • Devnet is the real, working environment — the already-minted PLSX token.
//   • Testnet is a real cluster but has NO PLSX token yet → mint = null. We do
//     NOT reuse the Devnet mint on Testnet, and we never invent an address.
//   • Mainnet is NOT launched → mint = null AND status "coming-soon", which
//     makes it non-selectable (see SELECTABLE) so users can never be switched
//     onto it. No fake mainnet data, ever.
//   • `features` gates what each network is allowed to show as real. Anything
//     false renders an honest "Coming Soon" — no fabricated swap/stake/lend/
//     borrow/liquidity/APY/TVL. The only true features are the keyless reads
//     (balance, SOL balance, mint security) and, on dev/testnet, requestAirdrop.

import { MINT_ADDRESS } from "@/lib/config";

/** Devnet — the working environment. Real PLSX token, real reads. */
export const DEVNET_CONFIG = {
  id: "devnet",
  cluster: "devnet", // Solana cluster moniker (also the explorer ?cluster= value)
  label: "Solana Devnet",
  short: "DEVNET",
  badge: "TESTING",
  tone: "test", // drives the amber "testing" accent
  rpc: process.env.NEXT_PUBLIC_DEVNET_RPC || "https://api.devnet.solana.com",
  mint: MINT_ADDRESS, // the real, already-minted PLSX devnet token
  status: "active", // 🟢 selectable + fully working
  statusLabel: "Active",
  disclaimer:
    "Devnet PLSX is intended for testing and has no intended monetary value.",
  features: {
    balance: true, // live PLSX balance
    security: true, // live mint status
    solBalance: true, // live SOL balance
    faucetSol: true, // real requestAirdrop (public faucet)
    faucetToken: false, // no PLSX faucet — needs a controlled mint authority
    swap: false,
    stake: false,
    lend: false,
    borrow: false,
    liquidity: false,
  },
};

/** Testnet — a real cluster, staging for advanced features. No PLSX yet. */
export const TESTNET_CONFIG = {
  id: "testnet",
  cluster: "testnet",
  label: "Solana Testnet",
  short: "TESTNET",
  badge: "BETA",
  tone: "beta",
  rpc: process.env.NEXT_PUBLIC_TESTNET_RPC || "https://api.testnet.solana.com",
  mint: null, // NO testnet token — never fabricated, never the devnet mint
  status: "beta", // 🔵 selectable Beta: SOL balance real; PLSX + DeFi Coming Soon
  statusLabel: "Beta",
  disclaimer:
    "Testnet is a staging environment. No PLSX token is deployed on Testnet yet, and test assets carry no value.",
  features: {
    balance: false, // no testnet PLSX mint → Coming Soon
    security: false, // no testnet mint to inspect
    solBalance: true, // real test-SOL balance
    faucetSol: true, // requestAirdrop exists on testnet (often heavily rate-limited)
    faucetToken: false,
    swap: false,
    stake: false,
    lend: false,
    borrow: false,
    liquidity: false,
  },
};

/** Mainnet — reserved future production. NOT launched, NOT selectable. */
export const MAINNET_CONFIG = {
  id: "mainnet-beta",
  cluster: "mainnet-beta",
  label: "Solana Mainnet",
  short: "MAINNET",
  badge: "COMING SOON",
  tone: "soon",
  rpc: process.env.NEXT_PUBLIC_MAINNET_RPC || "https://api.mainnet-beta.solana.com",
  mint: null, // not launched — never a fake address
  status: "coming-soon", // ⚪ view-only placeholder, cannot be activated
  statusLabel: "Coming Soon",
  disclaimer:
    "Mainnet is not launched. Final token allocation, liquidity, and audits will be published before any Mainnet launch.",
  features: {
    balance: false,
    security: false,
    solBalance: false,
    faucetSol: false,
    faucetToken: false,
    swap: false,
    stake: false,
    lend: false,
    borrow: false,
    liquidity: false,
  },
};

export const NETWORKS = {
  devnet: DEVNET_CONFIG,
  testnet: TESTNET_CONFIG,
  "mainnet-beta": MAINNET_CONFIG,
};

// Display order for the selector (Devnet first — it's the default + working env).
export const NETWORK_ORDER = ["devnet", "testnet", "mainnet-beta"];

// Default network the app boots into. NEVER mainnet.
export const DEFAULT_NETWORK_ID = "devnet";

// Only these can actually be switched to. Mainnet ("coming-soon") is excluded
// on purpose, so no code path can ever auto-switch a user onto Mainnet.
export const SELECTABLE = ["devnet", "testnet"];

/** Safe lookup: unknown / non-selectable ids fall back to the default. */
export function resolveNetwork(id) {
  return NETWORKS[id] || NETWORKS[DEFAULT_NETWORK_ID];
}

/** The DeFi features that are uniformly "Coming Soon" across the whole app. */
export const DEFI_FEATURES = [
  { key: "swap", title: "Swap", icon: "🔄", blurb: "Trade PLSX against other assets." },
  { key: "stake", title: "Stake", icon: "🔒", blurb: "Stake PLSX to support the network." },
  { key: "lend", title: "Lend", icon: "🏦", blurb: "Supply assets to earn yield." },
  { key: "borrow", title: "Borrow", icon: "📥", blurb: "Borrow against your collateral." },
  { key: "liquidity", title: "Liquidity", icon: "💧", blurb: "Provide liquidity to pools." },
];
