"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useNetwork } from "@/components/NetworkProvider";
import { connectionFor, getSolBalanceFor, formatLamports, explorerUrlFor } from "@/lib/solana";

// Live native SOL balance for the connected wallet on the selected (or a pinned)
// network. Pure client-side RPC read via connection.getBalance — real, keyless,
// nothing stored, no signing. Re-reads when the wallet or network changes.
//
// Props:
//   network  optional config to pin this card to (e.g. TESTNET_CONFIG on the
//            testnet page); defaults to the globally-selected network.
//   label    optional heading override (e.g. "Test SOL Balance").
export default function SolBalance({ network: pinned, label, refreshSignal = 0 }) {
  const ctx = useNetwork();
  const network = pinned || ctx.network;
  const { publicKey, connected } = useWallet();
  const [mounted, setMounted] = useState(false);
  const [lamports, setLamports] = useState(null); // number | null
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => setMounted(true), []);

  const address = publicKey?.toBase58() || "";
  const heading = label || (network.id === "devnet" ? "Your SOL Balance" : "Test SOL Balance");

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!connected || !address || !network.features.solBalance) {
        setLamports(null);
        return;
      }
      setLoading(true);
      setError("");
      try {
        const conn = connectionFor(network.rpc);
        const bal = await getSolBalanceFor(conn, address);
        if (!cancelled) setLamports(bal);
      } catch {
        if (!cancelled) setError("Couldn't read your SOL balance right now. Please try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [connected, address, network.rpc, network.features.solBalance, refreshSignal]);

  if (!mounted) {
    return (
      <div className="kpi">
        <div className="k-top">
          <span className="k-ic">◎</span>
        </div>
        <div className="k-val">…</div>
        <div className="k-lbl">{heading}</div>
      </div>
    );
  }

  return (
    <div className="kpi">
      <div className="k-top">
        <span className="k-ic">◎</span>
      </div>
      <div className="k-val">
        {!connected
          ? "—"
          : loading
            ? "…"
            : lamports != null
              ? formatLamports(lamports)
              : "0"}{" "}
        <span style={{ fontSize: 14, color: "var(--text-mute)" }}>SOL</span>
      </div>
      <div className="k-lbl">
        {heading}
        {connected && address ? (
          <>
            {" · "}
            <a
              href={explorerUrlFor(network.cluster, address, "address")}
              target="_blank"
              rel="noopener noreferrer"
            >
              Explorer ↗
            </a>
          </>
        ) : null}
      </div>
      {error ? (
        <div className="alert err" style={{ marginTop: 8, fontSize: 13 }}>
          {error}
        </div>
      ) : null}
    </div>
  );
}
