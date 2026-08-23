// A single DeFi feature rendered honestly as "Coming Soon".
//
// This site has NO DEX / lending / staking program integrated (only
// @solana/web3.js + wallet-adapter are installed), so none of swap / stake /
// lend / borrow / liquidity can execute a real transaction. Rather than fake a
// working UI, each renders as a disabled "Coming Soon" card that says plainly
// why. No prices, APY, APR, TVL, or liquidity numbers are ever shown.
export default function DefiCard({ icon, title, blurb }) {
  return (
    <div className="soon-card defi-card" aria-disabled="true">
      <div className="soon-ic" aria-hidden="true">
        {icon}
      </div>
      <div className="defi-card-body">
        <div className="defi-card-head">
          <h4>{title}</h4>
          <span className="soon-badge">Coming Soon</span>
        </div>
        <p className="brief">{blurb}</p>
        <p className="defi-card-why">Requires an on-chain program integration — not yet deployed.</p>
      </div>
    </div>
  );
}
