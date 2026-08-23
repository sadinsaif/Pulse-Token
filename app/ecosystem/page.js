import Navbar from "@/components/Navbar";
import Reveal from "@/components/Reveal";
import NetworkSelector from "@/components/NetworkSelector";
import EcosystemStatus from "@/components/EcosystemStatus";
import BalancePanel from "@/components/BalancePanel";
import SolBalance from "@/components/SolBalance";
import DefiCard from "@/components/DefiCard";
import TxSafetyNote from "@/components/TxSafetyNote";
import { PROJECT_NAME, TOKEN_SYMBOL } from "@/lib/config";
import { DEFI_FEATURES } from "@/config/networks";

export const metadata = {
  title: "PULSE Ecosystem — PLSX | Solana",
  description:
    "The PULSE (PLSX) ecosystem dashboard across Solana Devnet, Testnet, and Mainnet. Connect a wallet to read your live balances. DeFi features are clearly marked Coming Soon.",
};

// "PULSE ECOSYSTEM" — the premium multi-network dashboard.
//
// Everything here is honest: live PLSX + SOL balances (real RPC reads), a network
// selector (Devnet/Testnet selectable, Mainnet Coming Soon), and DeFi cards that
// are ALL "Coming Soon" because no on-chain program is integrated. No prices,
// APY, TVL, or fake transactions anywhere.
export default function EcosystemPage() {
  return (
    <>
      <Navbar />

      {/* ===================== HEADER ===================== */}
      <header className="section eco-head-section" id="top" style={{ paddingBottom: 20 }}>
        <div className="container">
          <div className="eco-head">
            <div className="eco-head-copy">
              <span className="tag">Dashboard</span>
              <h1>
                {PROJECT_NAME} <span className="grad">Ecosystem</span>.
              </h1>
              <p className="sub">
                One place for the {PROJECT_NAME} ({TOKEN_SYMBOL}) ecosystem across Solana Devnet, Testnet,
                and Mainnet. Live balances are read straight from the chain — nothing here is simulated.
              </p>
            </div>
            <div className="eco-head-select">
              <span className="eco-select-label">Network</span>
              <NetworkSelector />
            </div>
          </div>

          <Reveal style={{ marginTop: 8 }}>
            <EcosystemStatus />
          </Reveal>
        </div>
      </header>

      {/* ===================== YOUR ASSETS ===================== */}
      <section className="section" id="assets" style={{ paddingTop: 24 }}>
        <div className="container">
          <Reveal className="section-head">
            <span className="tag">Live</span>
            <h2>Your assets.</h2>
            <p>Connect a Solana wallet to read your live balances on the selected network — read-only, no signing.</p>
          </Reveal>

          <Reveal>
            <BalancePanel />
          </Reveal>

          <Reveal style={{ marginTop: 20 }}>
            <div className="panel" style={{ maxWidth: 720, margin: "0 auto" }}>
              <div className="panel-head">
                <h3 style={{ margin: 0 }}>Native SOL</h3>
              </div>
              <div className="kpis" style={{ gridTemplateColumns: "1fr" }}>
                <SolBalance />
              </div>
              <p className="brief" style={{ marginTop: 10, marginBottom: 0, color: "var(--text-mute)", fontSize: 13 }}>
                SOL pays Solana transaction fees. On Devnet/Testnet it&apos;s free test SOL with no value.
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ===================== DEFI (ALL COMING SOON) ===================== */}
      <section className="section" id="defi">
        <div className="container">
          <Reveal className="section-head">
            <span className="tag">DeFi</span>
            <h2>Ecosystem features.</h2>
            <p>
              These require on-chain program integrations that aren&apos;t deployed yet, so each is honestly
              marked <strong>Coming Soon</strong>. We never show fake prices, APY, TVL, or transactions.
            </p>
          </Reveal>
          <div className="soon-grid defi-grid">
            {DEFI_FEATURES.map((f) => (
              <Reveal key={f.key}>
                <DefiCard icon={f.icon} title={f.title} blurb={f.blurb} />
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ===================== TRANSACTION SAFETY ===================== */}
      <section className="section" id="safety" style={{ paddingTop: 0 }}>
        <div className="container">
          <Reveal style={{ maxWidth: 820, margin: "0 auto" }}>
            <TxSafetyNote />
          </Reveal>
        </div>
      </section>

      {/* ===================== FOOTER ===================== */}
      <footer className="footer">
        <div className="container">
          <div className="risk-disclaimer">
            <strong>Risk Disclaimer.</strong> {TOKEN_SYMBOL} is currently a Devnet testing token with no
            intended monetary value. Testnet and Mainnet features are not live. Nothing on this website
            constitutes financial or investment advice.
          </div>
          <div className="footer-bottom">
            <span>© 2026 {PROJECT_NAME}.</span>
            <span>
              <a href="/#top">← Back to home</a>
            </span>
          </div>
        </div>
      </footer>
    </>
  );
}
