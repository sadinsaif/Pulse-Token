import { TOKEN_SYMBOL } from "@/lib/config";

// Allocation buckets are shown as STRUCTURE ONLY. We do NOT invent percentages —
// every share reads "TBD" and the donut is an evenly-split placeholder, paired
// with an explicit "not finalized" note. Real numbers get published before
// Mainnet. Colours are tonal green→violet (brand palette), not data.
const BUCKETS = [
  ["Community", "#3ee0a0"],
  ["Liquidity", "#54e9b0"],
  ["Ecosystem", "#25c98e"],
  ["Treasury", "#a855f7"],
  ["Marketing", "#8b5cf6"],
  ["Team", "#c084fc"],
];

// 6 equal 60° segments — a neutral placeholder ring, not a real breakdown.
const donutBg = `conic-gradient(${BUCKETS.map(
  ([, color], i) => `${color} ${i * 60}deg ${(i + 1) * 60}deg`
).join(", ")})`;

/**
 * Tokenomics — honest placeholder. The donut + legend communicate the intended
 * allocation CATEGORIES without fabricating splits (all "TBD"), plus the fixed
 * total supply, which is a real on-chain fact.
 */
export default function Tokenomics({ totalSupply }) {
  return (
    <div className="tokenomics">
      <div className="donut-wrap">
        <div className="donut" style={{ background: donutBg }} role="img" aria-label="Token allocation — to be determined">
          <span className="val" style={{ fontSize: 22 }}>TBD</span>
        </div>
        <div className="legend">
          {BUCKETS.map(([label, color]) => (
            <div key={label}>
              <span className="sw" style={{ background: color }} />
              <span style={{ flex: 1 }}>{label}</span>
              <span style={{ color: "var(--text-mute)", fontWeight: 700 }}>TBD</span>
            </div>
          ))}
        </div>
      </div>

      <div className="tk-facts">
        <div className="tk-fact">
          <span className="tk-fact-label">Total Supply</span>
          <span className="tk-fact-val">{totalSupply} <em>{TOKEN_SYMBOL}</em></span>
        </div>
        <p className="tk-note">
          Final allocation and vesting details will be published before Mainnet launch.
        </p>
      </div>
    </div>
  );
}
