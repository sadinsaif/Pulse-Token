"use client";

import Reveal from "@/components/Reveal";
import DefiCard from "@/components/DefiCard";
import StakePanel from "@/components/StakePanel";
import StakeAdmin from "@/components/StakeAdmin";
import SwapPanel from "@/components/SwapPanel";
import SwapAdmin from "@/components/SwapAdmin";
import LendPanel from "@/components/LendPanel";
import LendAdmin from "@/components/LendAdmin";
import { useNetwork } from "@/components/NetworkProvider";
import { DEFI_FEATURES } from "@/config/networks";

/**
 * The DeFi feature grid, shared by /ecosystem (follows the global selector) and
 * /testnet (pinned). Behaviour is driven ENTIRELY by the selected network's
 * `features` flags — the honesty gate:
 *
 *   • When `features.stake` is true (real program deployed + funded + verified,
 *     devnet only), the Stake tile is replaced by the LIVE staking panel (plus
 *     the authority-only admin panel, which is invisible to everyone else).
 *   • Likewise `features.swap` swaps the Swap tile for the LIVE swap panel (+ its
 *     own authority-only admin), on the same deployed+seeded+verified gate.
 *   • Every other feature — and Stake/Swap themselves when their flag is false —
 *     stays an honest "Coming Soon" card. No fake swap/lend/borrow/liquidity, ever.
 *
 * Props: pinnedNetwork — pin to a specific network (testnet page); omitted on
 * /ecosystem so it follows the global NetworkSelector.
 */
export default function DefiGrid({ pinnedNetwork }) {
  const ctx = useNetwork();
  const network = pinnedNetwork || ctx.network;
  const stakeLive = Boolean(network.features?.stake && network.mint);
  const swapLive = Boolean(network.features?.swap && network.mint);
  const lendLive = Boolean(network.features?.lend && network.mint);
  const anyLive = stakeLive || swapLive || lendLive;

  // When a feature is live, its tile becomes a full panel above the grid, so drop
  // it from the "Coming Soon" card list.
  const liveKeys = new Set();
  if (stakeLive) liveKeys.add("stake");
  if (swapLive) liveKeys.add("swap");
  if (lendLive) liveKeys.add("lend");
  const cards = liveKeys.size ? DEFI_FEATURES.filter((f) => !liveKeys.has(f.key)) : DEFI_FEATURES;

  return (
    <>
      {/* Authority-only admin panels. Each renders for NO ONE except its exact
          authority wallet (and only on a network that has the PLSX mint), so they
          are decoupled from the public `features.*` flags on purpose: the authority
          must initialize + seed a pool BEFORE its public feature is switched on.
          The public never sees these. */}
      <StakeAdmin network={pinnedNetwork} />
      <SwapAdmin network={pinnedNetwork} />
      <LendAdmin network={pinnedNetwork} />

      {/* Public panels — only once each honesty gate (features.*) is on. */}
      {stakeLive ? (
        <Reveal>
          <StakePanel network={pinnedNetwork} />
        </Reveal>
      ) : null}
      {swapLive ? (
        <Reveal>
          <SwapPanel network={pinnedNetwork} />
        </Reveal>
      ) : null}
      {lendLive ? (
        <Reveal>
          <LendPanel network={pinnedNetwork} />
        </Reveal>
      ) : null}

      <div className="soon-grid defi-grid" style={anyLive ? { marginTop: 24 } : undefined}>
        {cards.map((f) => (
          <Reveal key={f.key}>
            <DefiCard icon={f.icon} title={f.title} blurb={f.blurb} />
          </Reveal>
        ))}
      </div>
    </>
  );
}
