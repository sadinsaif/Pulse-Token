import Navbar from "@/components/Navbar";
import Reveal from "@/components/Reveal";
import CopyAddress from "@/components/CopyAddress";
import BalancePanel from "@/components/BalancePanel";
import {
  NETWORK,
  TOKEN_SYMBOL,
  TOKEN_DECIMALS,
  TOKEN_MINT,
  isTokenConfigured,
  explorerUrl,
} from "@/lib/solana";

const NETWORK_LABEL =
  NETWORK === "mainnet-beta"
    ? "Solana Mainnet"
    : NETWORK === "devnet"
    ? "Solana Devnet"
    : `Solana ${NETWORK.charAt(0).toUpperCase()}${NETWORK.slice(1)}`;

const IS_MAINNET = NETWORK === "mainnet-beta";

// Intended fixed supply of the mint (1,000,000,000). Shown as a plain fact, never
// as a price or return promise.
const TOTAL_SUPPLY = "1,000,000,000";

const GLANCE = [
  ["Symbol", `$${TOKEN_SYMBOL}`],
  ["Total supply", TOTAL_SUPPLY],
  ["Decimals", String(TOKEN_DECIMALS)],
  ["Network", NETWORK_LABEL],
];

const UTILITY = [
  ["🔒", "Non-custodial", "$PULSE lives in your own wallet. Connecting here only reads your balance — it never moves, holds, or locks your tokens."],
  ["⚡", "Built on Solana", "A standard SPL token with fast, low-cost transfers. Your balance is read live from the Solana blockchain."],
  ["🪙", "Fixed supply", "1,000,000,000 $PULSE total. Verify the supply and mint yourself on-chain using the address below."],
  ["📖", "Utility, not investment", "$PULSE is a utility token — not a security or a promise of profit. Always do your own research."],
];

const STEPS = [
  ["Connect your wallet", "Use Phantom or Solflare on Solana. Connecting is read-only — it never moves funds or signs a transaction."],
  ["Hold $PULSE", "Keep your tokens in your own wallet. Nothing is deposited, staked, or locked up."],
  ["Check your balance", "Your live on-chain $PULSE balance appears instantly, read straight from the Solana blockchain."],
];

export default function TokenSitePage() {
  const configured = isTokenConfigured();

  return (
    <>
      <Navbar />

      {/* ===================== HERO ===================== */}
      <header className="hero hero-v2" id="top">
        <div className="container">
          <div className="hero-copy" style={{ maxWidth: 820, margin: "0 auto", textAlign: "center" }}>
            <span className="pill">
              <span className="dot"></span> {NETWORK_LABEL} · SPL utility token
            </span>
            <h1>
              $PULSE — a non-custodial token on{" "}
              <span className="grad">Solana</span>.
            </h1>
            <p className="sub" style={{ marginInline: "auto" }}>
              Your keys, your tokens. Connect your Solana wallet to see your{" "}
              <strong>live on-chain $PULSE balance</strong> — read-only, no signing, no deposits.
            </p>
            <div className="hero-actions" style={{ justifyContent: "center" }}>
              <a href="#balance" className="btn btn-primary btn-lg">
                Connect &amp; check balance →
              </a>
              <a href="#contract" className="btn btn-ghost btn-lg">
                Token details
              </a>
            </div>
            <p className="hero-note">
              $PULSE is a utility token, not an investment. Always do your own research.
            </p>
          </div>
        </div>
      </header>

      {/* ===================== AT A GLANCE ===================== */}
      <section className="works" aria-label="Token at a glance">
        <div className="container">
          <Reveal>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                gap: 14,
              }}
            >
              {GLANCE.map(([label, value]) => (
                <div
                  key={label}
                  style={{
                    background: "var(--bg-elev)",
                    border: "1px solid var(--border)",
                    borderRadius: 16,
                    padding: "18px 20px",
                    textAlign: "center",
                  }}
                >
                  <div style={{ fontSize: 24, fontWeight: 800, color: "var(--accent-3)" }}>{value}</div>
                  <div style={{ marginTop: 4, color: "var(--text-mute)", fontSize: 13 }}>{label}</div>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ===================== YOUR BALANCE (live dApp) ===================== */}
      <section className="section" id="balance">
        <div className="container">
          <Reveal className="section-head">
            <span className="tag">Live</span>
            <h2>Check your $PULSE.</h2>
            <p>Connect your Solana wallet to see your live on-chain balance — read-only, no signing, no transaction.</p>
          </Reveal>
          <Reveal>
            <BalancePanel />
          </Reveal>
        </div>
      </section>

      {/* ===================== UTILITY ===================== */}
      <section className="section" id="utility">
        <div className="container">
          <Reveal className="section-head">
            <span className="tag">Utility</span>
            <h2>What $PULSE is.</h2>
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
        </div>
      </section>

      {/* ===================== HOW IT WORKS ===================== */}
      <section className="section workflow-section" id="how">
        <div className="container">
          <Reveal className="section-head">
            <span className="tag">How it works</span>
            <h2>See your $PULSE in seconds.</h2>
            <p>No account, no sign-up — just your wallet. Fully non-custodial the whole way.</p>
          </Reveal>
          <ol className="workflow">
            {STEPS.map(([title, body], i) => (
              <Reveal as="li" className="wf-step" key={title}>
                <span className="wf-dot">{i + 1}</span>
                <div className="wf-icon">{["🔌", "🪙", "📊"][i]}</div>
                <h3>{title}</h3>
                <p>{body}</p>
              </Reveal>
            ))}
          </ol>
          <Reveal style={{ textAlign: "center", marginTop: 28 }}>
            <a href="#balance" className="btn btn-primary btn-lg">
              Connect &amp; check balance →
            </a>
          </Reveal>
        </div>
      </section>

      {/* ===================== CONTRACT / MINT ===================== */}
      <section className="section" id="contract">
        <div className="container">
          <Reveal className="section-head">
            <span className="tag">On-chain</span>
            <h2>Token address.</h2>
            <p>Always verify you&apos;re holding the official mint before interacting with $PULSE.</p>
          </Reveal>

          <Reveal
            style={{
              background: "var(--bg-elev)",
              border: "1px solid var(--border)",
              borderRadius: 18,
              padding: "26px 24px",
              maxWidth: 720,
              margin: "0 auto",
              textAlign: "center",
            }}
          >
            {configured ? (
              <>
                <div style={{ color: "var(--text-mute)", fontSize: 13, marginBottom: 10 }}>
                  {TOKEN_SYMBOL} mint · {NETWORK_LABEL}
                </div>
                <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
                  <CopyAddress value={TOKEN_MINT} />
                </div>
                <a
                  href={explorerUrl(TOKEN_MINT, "address")}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-ghost btn-sm"
                >
                  View on Solana Explorer ↗
                </a>
              </>
            ) : (
              <>
                <div style={{ fontSize: 40, marginBottom: 10 }} aria-hidden="true">🚀</div>
                <h3 style={{ margin: "0 0 8px" }}>Launching soon</h3>
                <p className="brief" style={{ margin: 0 }}>
                  The official $PULSE mint address will appear here once the token goes live on{" "}
                  {NETWORK_LABEL}. Until then, ignore any address claiming to be $PULSE.
                </p>
              </>
            )}
          </Reveal>
        </div>
      </section>

      {/* ===================== WHERE TO GET IT ===================== */}
      <section className="section" id="get">
        <div className="container">
          <Reveal className="section-head">
            <span className="tag">Where to get it</span>
            <h2>Getting $PULSE.</h2>
          </Reveal>
          <Reveal
            className="brief"
            style={{
              maxWidth: 720,
              margin: "0 auto",
              textAlign: "center",
              background: "var(--bg-elev)",
              border: "1px solid var(--border)",
              borderRadius: 16,
              padding: "22px 24px",
            }}
          >
            {IS_MAINNET ? (
              <p style={{ margin: 0 }}>
                Once liquidity is live, you&apos;ll be able to swap for $PULSE on Solana DEXes.
                Only ever buy against the official mint address shown above.
              </p>
            ) : (
              <p style={{ margin: 0 }}>
                $PULSE is currently on <strong>{NETWORK_LABEL}</strong> for testing — it has{" "}
                <strong>no monetary value</strong> and isn&apos;t for sale. On-chain trading and
                price will go live when $PULSE launches on Solana mainnet.
              </p>
            )}
          </Reveal>
        </div>
      </section>

      {/* ===================== THE HONEST BIT ===================== */}
      <section className="section">
        <div className="container">
          <Reveal
            style={{
              maxWidth: 860,
              margin: "0 auto",
              background: "var(--bg-elev)",
              border: "1px solid var(--border)",
              borderRadius: 18,
              padding: "26px 28px",
            }}
          >
            <h3 style={{ marginTop: 0 }}>The honest bit</h3>
            <ul className="pulse-points" style={{ marginBottom: 0 }}>
              <li>$PULSE is a <strong>utility token</strong>, not a security, share, or investment product.</li>
              <li>Nothing here is financial advice. Always <strong>do your own research</strong> before interacting with any token.</li>
              <li>It&apos;s <strong>non-custodial</strong> — this site only reads your balance; it never takes, holds, or locks your tokens.</li>
              <li>On devnet, $PULSE is for testing only and has no monetary value.</li>
            </ul>
          </Reveal>
        </div>
      </section>

      {/* ===================== FINAL CTA ===================== */}
      <section className="section">
        <div className="container">
          <Reveal className="cta-band final-cta">
            <h2>See your $PULSE balance.</h2>
            <p>Connect your Solana wallet — it takes a few seconds and never moves your funds.</p>
            <div className="final-cta-actions">
              <a href="#balance" className="btn btn-primary btn-lg">Connect &amp; check balance →</a>
              {configured ? (
                <a
                  href={explorerUrl(TOKEN_MINT, "address")}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-ghost btn-lg"
                >
                  View the mint ↗
                </a>
              ) : null}
            </div>
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
                <span className="wordmark"><span className="wm-fy">$</span>PULSE</span>
              </a>
              <p>A non-custodial utility token on Solana. Your keys, your tokens.</p>
            </div>
            <div className="footer-col">
              <h4>$PULSE</h4>
              <a href="#utility">Utility</a>
              <a href="#how">How it works</a>
              <a href="#balance">Your balance</a>
              <a href="#contract">Token address</a>
            </div>
            <div className="footer-col">
              <h4>On-chain</h4>
              {configured ? (
                <a href={explorerUrl(TOKEN_MINT, "address")} target="_blank" rel="noopener noreferrer">
                  View mint ↗
                </a>
              ) : null}
              <a href="https://explorer.solana.com" target="_blank" rel="noopener noreferrer">
                Solana Explorer ↗
              </a>
              <a href="https://solana.com" target="_blank" rel="noopener noreferrer">
                About Solana ↗
              </a>
            </div>
          </div>
          <div className="footer-bottom">
            <span>© 2026 $PULSE.</span>
            <span>$PULSE is a utility token, not an investment.</span>
          </div>
        </div>
      </footer>
    </>
  );
}
