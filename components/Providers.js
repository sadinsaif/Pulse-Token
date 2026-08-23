"use client";

import { useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { NetworkProvider, useNetwork } from "@/components/NetworkProvider";
import "@solana/wallet-adapter-react-ui/styles.css";

// The standalone site's single client-provider boundary.
//
// There is NO SessionProvider here — this site has no login of its own. It only
// needs Solana wallet context (connect + read on-chain balance); nothing here
// signs a transaction or touches a backend.
//
// NETWORK-REACTIVE: NetworkProvider sits on top and owns the selected network.
// SolanaProviders reads it and feeds the network's RPC into ConnectionProvider,
// so switching Devnet↔Testnet rebuilds the adapter's Connection (its documented
// behavior) and points every read at the right cluster. The connected wallet
// stays connected — only the RPC target changes.
//
// Empty adapter list on purpose: Phantom, Solflare, Backpack, etc. register via
// the Wallet Standard and are auto-detected, so we don't bundle per-wallet
// adapter packages. autoConnect silently reconnects a previously-approved wallet.

function SolanaProviders({ children }) {
  const { network } = useNetwork();
  const endpoint = useMemo(() => network.rpc, [network.rpc]);
  const wallets = useMemo(() => [], []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

export default function Providers({ children }) {
  return (
    <NetworkProvider>
      <SolanaProviders>{children}</SolanaProviders>
    </NetworkProvider>
  );
}
