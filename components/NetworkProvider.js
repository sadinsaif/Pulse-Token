"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  NETWORKS,
  DEFAULT_NETWORK_ID,
  SELECTABLE,
  resolveNetwork,
} from "@/config/networks";

// ============================================================================
// NetworkProvider — the selected Solana network, app-wide.
// ----------------------------------------------------------------------------
// Boots into Devnet (DEFAULT_NETWORK_ID) for a deterministic SSR render, then
// (after mount, to avoid hydration mismatch) restores a previously-chosen
// network from localStorage IF it is selectable. setNetworkId refuses anything
// not in SELECTABLE, so Mainnet ("coming-soon") can NEVER be activated — no code
// path auto-switches a user onto Mainnet.
// ============================================================================

const STORAGE_KEY = "pulse.network";

const NetworkContext = createContext(null);

export function NetworkProvider({ children }) {
  // Always start at the default so server and first client render agree.
  const [networkId, setNetworkId] = useState(DEFAULT_NETWORK_ID);

  // After mount: restore a saved, still-selectable choice.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved && SELECTABLE.includes(saved) && saved !== networkId) {
        setNetworkId(saved);
      }
    } catch {
      /* localStorage unavailable — stay on default */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectNetwork = useCallback((id) => {
    // Guard: only ever switch to an explicitly selectable network.
    if (!SELECTABLE.includes(id)) return false;
    setNetworkId(id);
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* ignore persistence failures */
    }
    return true;
  }, []);

  const value = useMemo(
    () => ({
      networkId,
      network: resolveNetwork(networkId),
      setNetworkId: selectNetwork,
      networks: NETWORKS,
    }),
    [networkId, selectNetwork]
  );

  return <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>;
}

/** Read the selected network. Falls back to the default config if used
 *  outside a provider, so components never crash. */
export function useNetwork() {
  const ctx = useContext(NetworkContext);
  if (!ctx) {
    return {
      networkId: DEFAULT_NETWORK_ID,
      network: resolveNetwork(DEFAULT_NETWORK_ID),
      setNetworkId: () => false,
      networks: NETWORKS,
    };
  }
  return ctx;
}
