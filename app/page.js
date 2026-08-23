import Navbar from "@/components/Navbar";
import Reveal from "@/components/Reveal";
import CopyAddress from "@/components/CopyAddress";
import BalancePanel from "@/components/BalancePanel";
import NetworkStatus from "@/components/NetworkStatus";
import Tokenomics from "@/components/Tokenomics";
import SecurityStatus from "@/components/SecurityStatus";
import FAQ from "@/components/FAQ";
import {
  PROJECT_NAME,
  TOKEN_SYMBOL,
  NETWORK_LABEL,
  TOTAL_SUPPLY,
  DECIMALS,
  MINT_ADDRESS,
  EXPLORER_TRANSFERS,
} from "@/lib/config";

// Top-line facts for the stats band. Values are real; nothing here implies price.
const STATS = [
  [TOTAL_SUPPLY, `Total Supply · ${TOKEN_SYMBOL}`],
  [String(DECIMALS), "Decimals"],
  [NETWORK_LABEL, "Network"],
  [TOKEN_SYMBOL, "Token"],
];

// What PLSX honestly IS today — no hype, no promises.
const UTILITY = [
  ["🔒", "Non-custodial", `${TOKEN_SYMBOL} lives in your own wallet. This site only reads your balance — it never moves, holds, or locks your tokens.`],
  ["⚡", "Built on Solana", "A standard SPL token with fast, low-cost transfers, read live from the Solana blockchain."],
  ["🪙", "Fixed supply", `${TOTAL_SUPPLY} ${TOKEN_SYMBOL}. Verify the supply and mint yourself on-chain any time.`],
  ["📖", "Utility, not investment", `${TOKEN_SYMBOL} is a utility token — not a security or a promise of profit. Always do your own research.`],
];

// Planned directions — explicitly "Coming Soon", explicitly NOT commitments.
const UTILITY_SOON = [
  ["Ecosystem Utility", "Real uses for PLSX are being explored as the ecosystem develops."],
  ["Community Rewards", "Ways to recognise the community are under exploration — nothing is guaranteed."],
  ["Governance", "Community input mechanisms may be considered before Mainnet."],
];

// 4-phase roadmap. Only real completions are marked Completed.
const ROADMAP = [
  ["done", "Phase 1", "Token Creation & Devnet Launch", `${TOKEN_SYMBOL} minted on Solana Devnet with a fixed supply and on-chain (Metaplex) metadata.`, "Completed"],
  ["prog", "Phase 2", "Website & Community", "This site is live and evolving; community channels are being set up.", "In Progress"],
  ["soon", "Phase 3", "Utility & Ecosystem", "Exploring genuine utility for PLSX. Details will be published before Mainnet.", "Coming Soon"],
  ["soon", "Phase 4", "Mainnet Launch", "Mainnet deployment with published tokenomics. No date is set yet.", "Coming Soon"],
];

const DOCS_SOON = [
  ["📄", "Whitepaper"],
  ["📚", "Documentation"],
  ["💻", "GitHub"],
];

export default function TokenSitePage() {
  return (
    <>
      <Navbar />

      {/* ===================== HERO ===================== */}
      <header className="hero hero-v2" id="top">
        <div className="container">
          <div className="hero-copy" style={{ maxWidth: 860, margin: "0 auto", textAlign: "center" }}>
            <span className="pill">
              <span className="dot"></span> DEVNET • TESTING
            </span>
            <h1>
              {PROJECT_NAME} — Built for the{" "}
              <span className="grad">Next Wave of Solana</span>.
            </h1>
            <p className="sub" style={{ marginInline: "auto" }}>
              {PROJECT_NAME} ({TOKEN_SYMBOL}) is a Solana-based token project currently running on{" "}
              <strong>{NETWORK_LABEL}</strong> while the ecosystem is being developed and tested.
            </p>
            <div className="hero-actions" style={{ justifyContent: "center" }}>
              <a href={EXPLORER_TRANSFERS} target="_blank" rel="noopener noreferrer" className="btn btn-green btn-lg">
                View on Solana Explorer ↗
              </a>
              <a href="#stats" className="btn btn-ghost btn-lg">
                Explore {TOKEN_SYMBOL}
              </a>
            </div>
            <p className="hero-note">
              {TOKEN_SYMBOL} is a Devnet testing token with no monetary value. Not financial advice.
            </p>
          </div>
        </div>
      </header>

      {/* ===================== LIVE TOKEN STATS ===================== */}
      <section className="section" id="stats" style={{ paddingTop: 40 }}>
        <div className="container">
          <Reveal>
            <div className="stats-band">
              {STATS.map(([value, label]) => (
                <div className="stat" key={label}>
                  <div className="big" style={{ fontSize: "clamp(20px, 3vw, 32px)", wordBreak: "break-word" }}>{value}</div>
                  <div className="lbl">{label}</div>
                </div>
              ))}
            </div>
          </Reveal>

          <Reveal style={{ marginTop: 26 }}>
            <NetworkStatus />
          </Reveal>

          <Reveal className="section-head" style={{ marginTop: 60, marginBottom: 28 }}>
            <span className="tag">Live</span>
            <h2>Your {TOKEN_SYMBOL} Balance.</h2>
            <p>Connect a Solana wallet to read your live on-chain balance — read-only, no signing, no transaction.</p>
          </Reveal>
          <Reveal>
            <BalancePanel />
          </Reveal>
        </div>
      </section>

      {/* ===================== ABOUT PULSE ===================== */}
      <section className="section" id="about">
        <div className="container">
          <Reveal className="section-head">
            <span className="tag">About</span>
            <h2>About {PROJECT_NAME}.</h2>
            <p>A Solana token project being built in the open — honest about exactly where it is today.</p>
          </Reveal>
          <Reveal
            className="brief"
            style={{
              maxWidth: 820, margin: "0 auto", textAlign: "center",
              background: "var(--lx-surface-grad)", border: "1px solid var(--lx-border)",
              borderRadius: "var(--radius-lg)", boxShadow: "var(--lx-shadow)", padding: "34px 32px",
            }}
          >
            <p style={{ margin: 0 }}>
              <strong>{PROJECT_NAME}</strong> is the project; <strong>{TOKEN_SYMBOL}</strong> is its token — a
              standard SPL token on Solana. Right now {TOKEN_SYMBOL} lives on <strong>{NETWORK_LABEL}</strong>,
              where the team is developing and testing the ecosystem. There is no Mainnet launch, no price, and
              no trading yet — everything you see here is verifiable on-chain, and anything not finalised is
              marked <em>Coming Soon</em> rather than invented.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ===================== PLSX UTILITY ===================== */}
      <section className="section" id="utility">
        <div className="container">
          <Reveal className="section-head">
            <span className="tag">Utility</span>
            <h2>What {TOKEN_SYMBOL} is today.</h2>
            <p>A straightforward Solana SPL token. Here&apos;s exactly how it behaves — no hype.</p>
          </Reveal>
          <div className="features why-choose">
            {UTILITY.map(([icon, title, body]) => (
              <Reveal className="feature" key={title}>
                <div className="feature-icon">{icon}</div>
                <h3>{title}</h3>
                <p>{body}</p>
              </Reveal>
            ))}
          </div>

          <Reveal style={{ textAlign: "center", margin: "48px 0 22px" }}>
            <h3 style={{ fontSize: 20, marginBottom: 6 }}>Planned directions</h3>
            <p className="brief" style={{ maxWidth: 560, margin: "0 auto" }}>
              Being explored as the ecosystem develops. These are <strong>not commitments</strong>.
            </p>
          </Reveal>
          <div className="soon-grid">
            {UTILITY_SOON.map(([title, body]) => (
              <Reveal className="soon-card" key={title}>
                <span className="soon-badge">Coming Soon</span>
                <h3>{title}</h3>
                <p>{body}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ===================== TOKENOMICS ===================== */}
      <section className="section" id="tokenomics">
        <div className="container">
          <Reveal className="section-head">
            <span className="tag">Tokenomics</span>
            <h2>Supply &amp; allocation.</h2>
            <p>The total supply is fixed and verifiable on-chain. Allocation is not finalised — no numbers are invented.</p>
          </Reveal>
          <Reveal
            style={{
              maxWidth: 900, margin: "0 auto",
              background: "var(--lx-surface-grad)", border: "1px solid var(--lx-border)",
              borderRadius: "var(--radius-lg)", boxShadow: "var(--lx-shadow)", padding: "34px 32px",
            }}
          >
            <Tokenomics totalSupply={TOTAL_SUPPLY} />
          </Reveal>
        </div>
      </section>

      {/* ===================== ROADMAP ===================== */}
      <section className="section" id="roadmap">
        <div className="container">
          <Reveal className="section-head">
            <span className="tag">Roadmap</span>
            <h2>Where {PROJECT_NAME} is headed.</h2>
            <p>Honest status only — a phase is &ldquo;Completed&rdquo; solely when it has actually shipped.</p>
          </Reveal>
          <div className="roadmap">
            {ROADMAP.map(([kind, phase, title, body, status]) => (
              <Reveal className={`rm-phase rm-${kind}`} key={phase}>
                <div className="rm-head">
                  <span className="rm-phase-label">{phase}</span>
                  <span className={`rm-status rm-status-${kind}`}>{status}</span>
                </div>
                <h3>{title}</h3>
                <p>{body}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ===================== SECURITY & TRANSPARENCY ===================== */}
      <section className="section" id="security">
        <div className="container">
          <Reveal className="section-head">
            <span className="tag">Security</span>
            <h2>Security &amp; transparency.</h2>
            <p>Read live from Solana — not claims. Verify every value yourself on Explorer.</p>
          </Reveal>
          <Reveal>
            <SecurityStatus />
          </Reveal>
        </div>
      </section>

      {/* ===================== TOKEN EXPLORER CARD ===================== */}
      <section className="section" id="explorer" style={{ paddingTop: 0 }}>
        <div className="container">
          <Reveal
            className="explore-card"
            style={{
              maxWidth: 720, margin: "0 auto", textAlign: "center",
              background: "var(--bg-elev)", border: "1px solid var(--border)",
              borderRadius: 18, padding: "30px 26px",
            }}
          >
            <div style={{ color: "var(--text-mute)", fontSize: 13, marginBottom: 12 }}>
              {TOKEN_SYMBOL} mint · {NETWORK_LABEL}
            </div>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}>
              <CopyAddress value={MINT_ADDRESS} />
            </div>
            <a href={EXPLORER_TRANSFERS} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">
              View on Solana Explorer ↗
            </a>
          </Reveal>
        </div>
      </section>

      {/* ===================== DOCUMENTATION ===================== */}
      <section className="section" id="docs">
        <div className="container">
          <Reveal className="section-head">
            <span className="tag">Docs</span>
            <h2>Documentation.</h2>
            <p>Whitepaper and developer docs are in progress and will be linked here when ready.</p>
          </Reveal>
          <div className="soon-grid">
            {DOCS_SOON.map(([icon, title]) => (
              <Reveal className="soon-card" key={title}>
                <span className="soon-badge">Coming Soon</span>
                <div className="soon-ic" aria-hidden="true">{icon}</div>
                <h3>{title}</h3>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ===================== COMMUNITY ===================== */}
      <section className="section" id="community">
        <div className="container">
          <Reveal className="section-head">
            <span className="tag">Community</span>
            <h2>Join the community.</h2>
          </Reveal>
          <Reveal
            className="brief"
            style={{
              maxWidth: 640, margin: "0 auto", textAlign: "center",
              background: "var(--bg-elev)", border: "1px solid var(--border)",
              borderRadius: 16, padding: "30px 26px",
            }}
          >
            <div style={{ fontSize: 34, marginBottom: 10 }} aria-hidden="true">🌐</div>
            <p style={{ margin: 0 }}>
              Community links coming soon. Official channels will be published here — until then, be cautious of
              any account or group claiming to represent {PROJECT_NAME}.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ===================== FAQ ===================== */}
      <section className="section" id="faq">
        <div className="container">
          <Reveal className="section-head">
            <span className="tag">FAQ</span>
            <h2>Frequently asked questions.</h2>
          </Reveal>
          <Reveal style={{ maxWidth: 780, margin: "0 auto" }}>
            <FAQ />
          </Reveal>
        </div>
      </section>

      {/* ===================== FOOTER ===================== */}
      <footer className="footer">
        <div className="container">
          <div className="footer-grid">
            <div className="footer-brand">
              <a href="#top" className="logo">
                <span className="logo-mark" aria-hidden="true" />
                <span className="wordmark">{PROJECT_NAME}</span>
              </a>
              <p>A Solana token project ({TOKEN_SYMBOL}), currently on {NETWORK_LABEL}. Your keys, your tokens.</p>
            </div>
            <div className="footer-col">
              <h4>Project</h4>
              <a href="#about">About</a>
              <a href="#tokenomics">Tokenomics</a>
              <a href="#roadmap">Roadmap</a>
              <a href="#security">Security</a>
            </div>
            <div className="footer-col">
              <h4>Token</h4>
              <a href="#stats">Your balance</a>
              <a href="#utility">Utility</a>
              <a href="#faq">FAQ</a>
              <a href="#docs">Docs</a>
            </div>
            <div className="footer-col">
              <h4>On-chain</h4>
              <a href={EXPLORER_TRANSFERS} target="_blank" rel="noopener noreferrer">View mint ↗</a>
              <a href="https://explorer.solana.com" target="_blank" rel="noopener noreferrer">Solana Explorer ↗</a>
              <a href="https://solana.com" target="_blank" rel="noopener noreferrer">About Solana ↗</a>
            </div>
          </div>

          <div className="risk-disclaimer">
            <strong>Risk Disclaimer.</strong> {TOKEN_SYMBOL} is currently a Devnet testing token. It has no
            intended monetary value on Devnet. Nothing on this website constitutes financial or investment advice.
          </div>

          <div className="footer-bottom">
            <span>© 2026 {PROJECT_NAME}.</span>
            <span>{PROJECT_NAME} — {TOKEN_SYMBOL} · {NETWORK_LABEL}</span>
          </div>
        </div>
      </footer>
    </>
  );
}
