/**
 * EIP-6963 (Multi-Injected Provider Discovery) utilities.
 *
 * Wallets announce themselves via `eip6963:announceProvider`. To capture
 * announcements that fired before our listener was attached, the page emits
 * `eip6963:requestProvider`, which every spec-compliant wallet answers by
 * re-announcing. The user always picks a wallet explicitly — we NEVER auto-swap
 * to `window.ethereum` or call `eth_requestAccounts` without a user gesture.
 */

export interface EIP6963ProviderInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

export interface EIP6963Provider {
  request(args: { method: string; params?: unknown[] | Record<string, unknown> }): Promise<unknown>;
  on?(event: string, handler: (...args: any[]) => void): void;
  removeListener?(event: string, handler: (...args: any[]) => void): void;
  isMetaMask?: boolean;
}

export interface EIP6963ProviderDetail {
  info: EIP6963ProviderInfo;
  provider: EIP6963Provider;
}

export interface EIP6963AnnounceProviderEvent extends CustomEvent<EIP6963ProviderDetail> {}

const ANNOUNCE = "eip6963:announceProvider";
const REQUEST = "eip6963:requestProvider";

const announced = new Map<string, EIP6963ProviderDetail>();
let listenersAttached = false;

function handleAnnounce(event: EIP6963AnnounceProviderEvent) {
  const detail = event?.detail;
  if (!detail?.info?.rdns || !detail?.provider) return;
  announced.set(detail.info.rdns, detail);
}

function attachGlobalListener() {
  if (listenersAttached || typeof window === "undefined") return;
  window.addEventListener(ANNOUNCE, handleAnnounce as EventListener);
  listenersAttached = true;
}

/** Ask every installed wallet to (re)announce. Call after attaching listeners. */
export function requestProviderAnnouncements() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(REQUEST));
}

/** Start one-shot discovery and return the currently known wallets. */
export function startEip6963Discovery(): EIP6963ProviderDetail[] {
  attachGlobalListener();
  requestProviderAnnouncements();
  return Array.from(announced.values());
}

/**
 * Subscribe to ongoing announcements. Returns an unsubscribe function.
 * Re-wrapped so React StrictMode double-invocation is safe.
 */
export function subscribeToProviders(onAnnounce: (detail: EIP6963ProviderDetail) => void): () => void {
  if (typeof window === "undefined") return () => {};
  attachGlobalListener();
  const listener = (event: EIP6963AnnounceProviderEvent) => {
    const detail = event?.detail;
    if (!detail?.info?.rdns || !detail?.provider) return;
    announced.set(detail.info.rdns, detail);
    onAnnounce(detail);
  };
  window.addEventListener(ANNOUNCE, listener as EventListener);
  requestProviderAnnouncements();
  return () => window.removeEventListener(ANNOUNCE, listener as EventListener);
}

export function getAnnouncedProviders(): EIP6963ProviderDetail[] {
  return Array.from(announced.values());
}

/** Pick a provider explicitly selected by the user (never a fallback). */
export function getProviderByRdns(rdns: string): EIP6963ProviderDetail | undefined {
  return announced.get(rdns);
}

/**
 * Normalise the account-change / chain-change events emitted by the selected
 * provider so downstream UI is provider-agnostic.
 */
export function bindProviderEvents(
  provider: EIP6963Provider,
  handlers: { onAccountsChanged: (accounts: string[]) => void; onChainChanged: (chainId: string) => void },
) {
  if (typeof provider?.on !== "function") return () => {};
  const onAccounts = (accounts: unknown) => {
    if (Array.isArray(accounts)) handlers.onAccountsChanged(accounts.map(String));
  };
  const onChain = (chainId: unknown) => handlers.onChainChanged(String(chainId ?? ""));
  provider.on("accountsChanged", onAccounts);
  provider.on("chainChanged", onChain);
  return () => {
    provider.removeListener?.("accountsChanged", onAccounts);
    provider.removeListener?.("chainChanged", onChain);
  };
}

/** Running in a mobile / embedded WebView-ish context? */
export function isLikelyMobile() {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}