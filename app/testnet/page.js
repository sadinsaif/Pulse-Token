"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import Navbar from "@/components/Navbar";
import Reveal from "@/components/Reveal";
import NetworkSelector from "@/components/NetworkSelector";
import BalancePanel from "@/components/BalancePanel";
import SolBalance from "@/components/SolBalance";
import TestSolFaucet from "@/components/TestSolFaucet";
import DefiGrid from "@/components/DefiGrid";
import TxSafetyNote from "@/components/TxSafetyNote";
import WalletConnectButton from "@/components/WalletConnectButton";
import { useNetwork } from "@/components/NetworkProvider";
import { shortAddress, explorerUrlFor } from "@/lib/solana";
import { TOKEN_SYMBOL } from "@/lib/config";
import { TESTNET_CONFIG } from "@/config/networks";

// "PLSX Testnet Playground" — the advanced-feature staging environment.
//
// This page is pinned to Solana Testnet (a real cluster). On mount it also sets
// the global selector to Testnet so the nav reflects where you are. It shows the
// real, keyless things Testnet supports today — wallet connect, live test-SOL
// balance, a real requestAirdrop faucet — and is honest that there is NO PLSX
// token on Testnet yet and that all DeFi features are Coming Soon.
const NET = TESTNET_CONFIG;

export default function TestnetPage() {
  const { setNetworkId } = useNetwork();
  const { publicKey, connected } = useWallet();
  const [mounted, setMounted] = useState(false);
  const [solRefresh, setSolRefresh] = useState(0);

  useEffect(() => {
    setMounted(true);
    setNetworkId("testnet"); // reflect the playground network in the nav selector
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const address = publicKey?.toBase58() || "";
  const isConnected = mounted && connected;

  return (
    <>
      <Navbar />

      {/* ===================== HEADER ===================== */}
      <header className="section eco-head-section" id="top" style={{ paddingBottom: 20 }}>
        <div className="container">
          <div className="eco-head">
            <div className="eco-head-copy">
              <span className="pill tone-beta">
                <span className="dot" /> TESTNET • BETA
              </span>
              <h1>
                {TOKEN_SYMBOL} <span className="grad">Testnet Playground</span>.
              </h1>
              <p className="sub">Explore the PULSE ecosystem using test assets before Mainnet.</p>
            </div>
            <div className="eco-head-select">
              <span className="eco-select-label">Network</span>
              <NetworkSelector />
            </div>
          </div>

          {/* Connection status strip */}
          <Reveal style={{ marginTop: 10 }}>
            <div className="tn-status">
              <div className="tn-status-item">
                <span className="tn-k">Status</span>
                <span className="tn-v">
                  <span className={`tn-dot ${isConnected ? "is-on" : "is-off"}`} />
                  {isConnected ? "Connected" : "Not connected"}
                </span>
              </div>
              <div className="tn-status-item">
                <span className="tn-k">Network</span>
                <span className="tn-v">{NET.label}</span>
              </div>
              <div className="tn-status-item">
                <span className="tn-k">Wallet</span>
                <span className="tn-v">
                  {isConnected ? (
                    <a
                      href={explorerUrlFor(NET.cluster, address, "address")}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {shortAddress(address, 4, 4)} ↗
                    </a>
                  ) : (
                    "—"
                  )}
                </span>
              </div>
              {!isConnected ? (
                <div className="tn-status-action">
                  <WalletConnectButton className="btn btn-green btn-sm" />
                </div>
              ) : null}
            </div>
          </Reveal>
        </div>
      </header>

      {/* ===================== BALANCES + FAUCET ===================== */}
      <section className="section" id="assets" style={{ paddingTop: 24 }}>
        <div className="container">
          <div className="tn-grid">
            <Reveal>
              <div className="panel" style={{ margin: 0 }}>
                <div className="panel-head">
                  <h3 style={{ margin: 0 }}>Test balances</h3>
                  <span className="tag-pill tone-beta">{NET.short}</span>
                </div>
                <div className="kpis" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
                  <SolBalance network={NET} label="Test SOL Balance" refreshSignal={solRefresh} />
                  <div className="kpi">
                    <div className="k-top"><span className="k-ic">🪙</span></div>
                    <div className="k-val" style={{ fontSize: 16 }}>Coming Soon</div>
                    <div className="k-lbl">{TOKEN_SYMBOL} (no Testnet token yet)</div>
                  </div>
                </div>
                <p className="brief" style={{ marginTop: 10, marginBottom: 0, color: "var(--text-mute)", fontSize: 13 }}>
                  There is no {TOKEN_SYMBOL} token on Testnet yet — we never reuse the Devnet mint or invent one.
                </p>
              </div>
            </Reveal>

            <Reveal>
              <TestSolFaucet network={NET} onFunded={() => setSolRefresh((n) => n + 1)} />
            </Reveal>
          </div>

          {/* PLSX balance panel (honest Coming Soon on Testnet) */}
          <Reveal style={{ marginTop: 20 }}>
            <BalancePanel network={NET} />
          </Reveal>
        </div>
      </section>

      {/* ===================== DEFI (ALL COMING SOON) ===================== */}
      <section className="section" id="defi">
        <div className="container">
          <Reveal className="section-head">
            <span className="tag">Playground</span>
            <h2>Test the ecosystem.</h2>
            <p>
              When these are wired to real on-chain programs, you&apos;ll test them here first. Until then
              each is honestly <strong>Coming Soon</strong> — no simulated swaps, rewards, or balances.
            </p>
          </Reveal>
          <DefiGrid pinnedNetwork={NET} />
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
            <strong>Risk Disclaimer.</strong> Testnet is a staging environment. Test assets have no monetary
            value, no {TOKEN_SYMBOL} token is deployed on Testnet, and DeFi features are not live. Nothing
            here is financial or investment advice.
          </div>
          <div className="footer-bottom">
            <span>© 2026 PULSE.</span>
            <span>
              <a href="/#top">← Back to home</a>
              {"  ·  "}
              <a href="/ecosystem">Ecosystem →</a>
            </span>
          </div>
        </div>
      </footer>
    </>
  );
}
