"use client";

import Reveal from "@/components/Reveal";
import DefiCard from "@/components/DefiCard";
import StakePanel from "@/components/StakePanel";
import StakeAdmin from "@/components/StakeAdmin";
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
 *   • Every other feature — and Stake itself when the flag is false — stays an
 *     honest "Coming Soon" card. No fake swap/lend/borrow/liquidity, ever.
 *
 * Props: pinnedNetwork — pin to a specific network (testnet page); omitted on
 * /ecosystem so it follows the global NetworkSelector.
 */
export default function DefiGrid({ pinnedNetwork }) {
  const ctx = useNetwork();
  const network = pinnedNetwork || ctx.network;
  const stakeLive = Boolean(network.features?.stake && network.mint);

  // When staking is live, the Stake tile becomes a full panel above the grid,
  // so drop it from the "Coming Soon" card list.
  const cards = stakeLive ? DEFI_FEATURES.filter((f) => f.key !== "stake") : DEFI_FEATURES;

  return (
    <>
      {/* Authority-only admin. It renders for NO ONE except the exact pool
          authority wallet (and only on a network that has the PLSX mint), so it
          is decoupled from the public `features.stake` flag on purpose: the
          authority must be able to initialize + fund the pool BEFORE the public
          Stake feature is switched on. The public never sees it. */}
      <StakeAdmin network={pinnedNetwork} />

      {/* Public Stake panel — only once the honesty gate (features.stake) is on. */}
      {stakeLive ? (
        <Reveal>
          <StakePanel network={pinnedNetwork} />
        </Reveal>
      ) : null}

      <div className="soon-grid defi-grid" style={stakeLive ? { marginTop: 24 } : undefined}>
        {cards.map((f) => (
          <Reveal key={f.key}>
            <DefiCard icon={f.icon} title={f.title} blurb={f.blurb} />
          </Reveal>
        ))}
      </div>
    </>
  );
}
