"use client";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import {
  bindProviderEvents,
  EIP6963ProviderDetail,
  getProviderByRdns,
  subscribeToProviders,
} from "@/lib/wallets/eip6963";
import { saveWalletAddress } from "@/lib/api";

export type WalletStatus = "idle" | "connecting" | "connected" | "error";

export interface WalletState {
  status: WalletStatus;
  providerRdns: string | null;
  providerName: string | null;
  address: string | null;
  chainId: string | null;
  providerIcon: string | null;
  error: string | null;
  syncingToBackend: boolean;
}

type Listener = () => void;

// --- module-scoped store (singleton shared by Header + Wallet page) ----------
let providers: EIP6963ProviderDetail[] = [];
let state: WalletState = {
  status: "idle",
  providerRdns: null,
  providerName: null,
  address: null,
  chainId: null,
  providerIcon: null,
  error: null,
  syncingToBackend: false,
};
const listeners = new Set<Listener>();

let eventUnbind: (() => void) | null = null;
let discoveryStarted = false;

function emit() {
  for (const listener of listeners) listener();
}

function setState(patch: Partial<WalletState>) {
  state = { ...state, ...patch };
  emit();
}

function restoreFromLocalStorage() {
  if (typeof window === "undefined") return;
  const saved = window.localStorage.getItem("agentfi_wallet");
  if (saved && !state.address) {
    state = { ...state, address: saved, providerName: null, providerRdns: null };
  }
}

/** Ask every announced wallet to be listed; idempotent across components. */
export function refreshWalletProviders() {
  subscribeToProviders(() => {
    providers = Array.from(providers);
    emit();
  })();
  providers = [];
  emit();
}

function startDiscovery() {
  if (discoveryStarted || typeof window === "undefined") return;
  discoveryStarted = true;
  subscribeToProviders((detail) => {
    const index = providers.findIndex((p) => p.info.rdns === detail.info.rdns);
    if (index === -1) providers.push(detail);
    else if (providers[index].provider !== detail.provider) providers[index] = detail;
    // If the user had a saved address and this wallet just announced, keep it.
    restoreFromLocalStorage();
    emit();
  });
}

function syncToBackend(address: string | null) {
  setState({ syncingToBackend: true });
  const run = async () => {
    try {
      await saveWalletAddress(address, "ethereum");
    } catch {
      // Best-effort: the local store still reflects the user's explicit choice.
    } finally {
      setState({ syncingToBackend: false });
    }
  };
  if (typeof window !== "undefined") void run();
}

async function connectInternal(rdns: string) {
  const detail = getProviderByRdns(rdns) || providers.find((p) => p.info.rdns === rdns);
  if (!detail) {
    setState({ status: "error", error: "Wallet is no longer available. Reopen the picker and try again." });
    return;
  }
  const { provider, info } = detail;
  setState({ status: "connecting", providerRdns: info.rdns, providerName: info.name, providerIcon: info.icon, error: null });

  try {
    const accounts = ((await provider.request({ method: "eth_requestAccounts" })) as string[]) || [];
    if (!accounts?.[0]) {
      setState({ status: "error", error: "No account was returned by the wallet." });
      return;
    }
    let chainId: string | null = null;
    try {
      chainId = String((await provider.request({ method: "eth_chainId" })) ?? "");
    } catch {
      chainId = null;
    }

    if (typeof window !== "undefined") window.localStorage.setItem("agentfi_wallet", accounts[0]);

    eventUnbind?.();
    eventUnbind = bindProviderEvents(provider, {
      onAccountsChanged: (next) => {
        if (!next?.[0]) {
          setState({ status: "idle", address: null, providerRdns: null, providerName: null, chainId: null });
          if (typeof window !== "undefined") window.localStorage.removeItem("agentfi_wallet");
          return;
        }
        setState({ address: next[0] });
        if (typeof window !== "undefined") window.localStorage.setItem("agentfi_wallet", next[0]);
        syncToBackend(next[0]);
      },
      onChainChanged: (next) => setState({ chainId: next || null }),
    });

    setState({ status: "connected", address: accounts[0], chainId, providerName: info.name, providerRdns: info.rdns, providerIcon: info.icon });
    syncToBackend(accounts[0]);
  } catch (error: any) {
    const code = error?.code ?? error?.message;
    const cancelled = code === 4001 || /reject|denied|cancelled by user/i.test(String(error?.message || ""));
    setState({
      status: "error",
      error: cancelled
        ? "Connection request was rejected. You can try again whenever you are ready."
        : String(error?.message || "Could not connect to the wallet."),
    });
  }
}

function disconnectInternal() {
  eventUnbind?.();
  eventUnbind = null;
  if (typeof window !== "undefined") {
    const had = window.localStorage.getItem("agentfi_wallet");
    window.localStorage.removeItem("agentfi_wallet");
    if (had) syncToBackend(null);
  }
  setState({ status: "idle", address: null, providerRdns: null, providerName: null, chainId: null, providerIcon: null, error: null });
}

// --- React hook ---------------------------------------------------------------
export function useWallet() {
  useEffect(() => {
    startDiscovery();
    restoreFromLocalStorage();
  }, []);

  const snapshot = useSyncExternalStore(
    (onStoreChange) => {
      listeners.add(onStoreChange);
      return () => {
        listeners.delete(onStoreChange);
      };
    },
    () => state,
    () => state,
  );

  const connect = useCallback((rdns: string) => {
    void connectInternal(rdns);
  }, []);

  const disconnect = useCallback(() => {
    disconnectInternal();
  }, []);

  return useMemo(
    () => ({
      ...snapshot,
      providers,
      connect,
      disconnect,
      connectedAddress: snapshot.address,
    }),
    [snapshot, connect, disconnect],
  );
}