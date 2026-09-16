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