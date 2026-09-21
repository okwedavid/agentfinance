export interface InjectedWalletOption {
  provider: any;
  label: string;
}

const PROVIDER_HINTS: Array<[string, string]> = [
  ["isRabby", "Rabby"],
  ["isBraveWallet", "Brave Wallet"],
  ["isMetaMask", "MetaMask"],
  ["isCoinbaseWallet", "Coinbase Wallet"],
  ["isOKExWallet", "OKX Wallet"],
  ["isOkxWallet", "OKX Wallet"],
  ["isTrust", "Trust Wallet"],
  ["isWalletConnect", "WalletConnect"],
  ["isTokenPocket", "TokenPocket"],
  ["isImToken", "imToken"],
  ["isBitKeep", "BitKeep"],
];

export function providerLabel(provider: any): string {
  if (!provider || typeof provider !== "object") return "Browser wallet";
  for (const [flag, label] of PROVIDER_HINTS) {
    if (provider[flag]) return label;
  }
  return "Browser wallet";
}

export function detectInjectedProviders(ethereum: any): InjectedWalletOption[] {
  if (!ethereum || typeof ethereum !== "object") return [];

  const raw: any[] = Array.isArray(ethereum.providers) && ethereum.providers.length > 0
    ? ethereum.providers
    : [ethereum];

  const seen = new Set<string>();
  const options: InjectedWalletOption[] = [];
  for (const provider of raw) {
    const label = providerLabel(provider);
    if (seen.has(label)) continue;
    seen.add(label);
    options.push({ provider, label });
  }

  if (options.length === 0 && ethereum) {
    return [{ provider: ethereum, label: providerLabel(ethereum) }];
  }
  return options;
}

// EIP-6963 ("Wallet Standard") discovery. Providers that support it announce
// themselves via the `eip6963:announceProvider` event after the page requests
// them with `eip6963:requestProvider`. This is the modern replacement for
// crawling `window.ethereum.providers`.
//
// Returns a promise that resolves when the discovery window closes so callers
// can render the picker once — this never auto-connects and never requests
// accounts without a user gesture.

export const EIP6963_REQUEST_EVENT = "eip6963:requestProvider";
export const EIP6963_ANNOUNCE_EVENT = "eip6963:announceProvider";

export interface Eip6963WalletInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

export interface Eip6963ProviderDetail {
  info: Eip6963WalletInfo;
  provider: any;
}

export function isEip6963Supported(): boolean {
  return typeof window !== "undefined" && "dispatchEvent" in window && typeof CustomEvent !== "undefined";
}

/** Fire the discovery request and collect announced providers for a short window. */
export async function discoverEip6963Providers(timeoutMs = 1000): Promise<Eip6963ProviderDetail[]> {
  if (!isEip6963Supported()) return [];

  return new Promise((resolve) => {
    const announced = new Map<string, Eip6963ProviderDetail>();
    const timer = window.setTimeout(() => {
      window.removeEventListener(EIP6963_ANNOUNCE_EVENT, onAnnounce);
      resolve(Array.from(announced.values()));
    }, timeoutMs);

    function onAnnounce(event: Event) {
      const detail = (event as CustomEvent<Eip6963ProviderDetail>).detail;
      if (detail?.provider && detail?.info?.name) {
        const key = detail.info.rdns || detail.info.uuid || detail.info.name;
        if (!announced.has(key)) announced.set(key, detail);
      }
    }

    window.addEventListener(EIP6963_ANNOUNCE_EVENT, onAnnounce);
    window.dispatchEvent(new CustomEvent(EIP6963_REQUEST_EVENT, { detail: {} }));
  });
}

/** Merge EIP-6963-announced wallets with legacy injected providers, deduped. */
export async function collectWalletOptions(): Promise<InjectedWalletOption[]> {
  const [eip6963, injected] = await Promise.all([
    discoverEip6963Providers(),
    Promise.resolve(detectInjectedProviders((window as any).ethereum)),
  ]);

  const options: InjectedWalletOption[] = [];
  const seen = new Set<string>();

  for (const detail of eip6963) {
    const key = detail.info.rdns || detail.info.uuid || detail.info.name;
    if (seen.has(key)) continue;
    seen.add(key);
    options.push({ provider: detail.provider, label: detail.info.name || "Browser wallet" });
  }

  for (const option of injected) {
    const key = option.label;
    if (seen.has(key)) continue;
    seen.add(key);
    options.push(option);
  }

  return options;
}

export async function requestWalletAccounts(provider: any): Promise<string[]> {
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  return Array.isArray(accounts) ? accounts : [];
}

export async function switchWalletNetwork(provider: any, chainIdHex: string): Promise<void> {
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex }],
    });
  } catch (err: any) {
    const code = err?.code;
    if (code === 4902 || err?.message?.includes("Unrecognized chain")) {
      throw new Error("This network is not added to your wallet yet. Add it manually and try again.");
    }
    if (code === 4001) return;
    throw err;
  }
}

export const NO_WALLET_MESSAGE =
  "No browser wallet was detected on this device. Install MetaMask or another wallet extension, then refresh this page.";