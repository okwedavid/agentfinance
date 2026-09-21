// Mobile / "no wallet detected" install affordance.
// WalletConnect deep links are gated on NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID so
// the UI never shows a dead deep link when the frontend lacks the project id.

export interface WalletInstallLink {
  name: string;
  url: string;
}

const WC_PROJECT_ID =
  typeof process !== "undefined" ? process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID : undefined;

export const MOBILE_WALLET_INSTALLS: WalletInstallLink[] = [
  { name: "MetaMask", url: "https://metamask.io/download/" },
  { name: "Coinbase Wallet", url: "https://www.coinbase.com/wallet" },
  { name: "Trust Wallet", url: "https://trustwallet.com/download" },
  { name: "Rabby", url: "https://rabby.io" },
];

export function walletConnectInstallLinks(): WalletInstallLink[] {
  if (!WC_PROJECT_ID) return [];
  return [{ name: "WalletConnect", url: "https://walletconnect.com/explorer" }];
}

export function isWalletConnectConfigured(): boolean {
  return Boolean(WC_PROJECT_ID);
}
