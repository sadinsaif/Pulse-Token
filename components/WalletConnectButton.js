"use client";

import { useEffect, useState, useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { shortAddress } from "@/lib/solana";

/**
 * Connect / disconnect button styled with PulseFy's own `.btn` classes (not the
 * wallet-adapter default look). Opens the wallet-select modal when disconnected;
 * shows the short address and disconnects on click when connected.
 *
 * Wallet state is client-only, so a `mounted` guard renders a stable placeholder
 * for the server + first client paint — this avoids the hydration mismatch that
 * injected wallet extensions otherwise cause.
 */
export default function WalletConnectButton({ className = "btn btn-primary" }) {
  const { publicKey, connected, connecting, disconnect, wallet } = useWallet();
  const { setVisible } = useWalletModal();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const address = publicKey?.toBase58() || "";

  const onClick = useCallback(() => {
    if (connected) disconnect().catch(() => {});
    else setVisible(true);
  }, [connected, disconnect, setVisible]);

  if (!mounted) {
    return (
      <button className={className} disabled aria-hidden="true">
        Connect Wallet
      </button>
    );
  }

  if (connected && address) {
    return (
      <button className={className} onClick={onClick} title="Click to disconnect">
        {wallet?.adapter?.icon ? (
          <img
            src={wallet.adapter.icon}
            alt=""
            width={16}
            height={16}
            style={{ borderRadius: 4, marginRight: 8, verticalAlign: "-3px" }}
          />
        ) : null}
        {shortAddress(address, 4, 4)}
      </button>
    );
  }

  return (
    <button className={className} onClick={onClick} disabled={connecting}>
      {connecting ? "Connecting…" : "Connect Wallet"}
    </button>
  );
}
