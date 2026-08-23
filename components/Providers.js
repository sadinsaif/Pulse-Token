"use client";

import { useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { getRpcEndpoint } from "@/lib/solana";
import "@solana/wallet-adapter-react-ui/styles.css";

// The standalone site's single client-provider boundary.
//
// Unlike the main app there is NO SessionProvider here — this site has no login of
// its own. It only needs Solana wallet context (connect + read on-chain balance);
// anything that requires an authenticated PulseFy account (verify wallet, view
// rewards, claim) deep-links to the main app.
//
// Empty adapter list on purpose: Phantom, Solflare, Backpack, etc. register via the
// Wallet Standard and are auto-detected, so we don't bundle per-wallet adapter
// packages. autoConnect silently reconnects a previously-approved wallet.
export default function Providers({ children }) {
  const endpoint = useMemo(() => getRpcEndpoint(), []);
  const wallets = useMemo(() => [], []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
