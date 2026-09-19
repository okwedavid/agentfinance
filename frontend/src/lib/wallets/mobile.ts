/**
 * Mobile fallback wallet support.
 *
 * When the EIP-6963 discovery list is empty on mobile (e.g. in a standalone
 * browser tab where installed wallets did not announce), we surface explicit
 * install + deep-link options for well-known wallets instead of silently
 * auto-connecting to `window.ethereum`.
 *
 * WalletConnect flows are strictly gated on NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID.
 * Without it the entry is shown as "requires configuration", never as a
 * silently-dead button. API keys / project secrets are never logged.
 */

export const WALLETCONNECT_PROJECT_ID = (process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "").trim();

export function isWalletConnectConfigured() {
  return WALLETCONNECT_PROJECT_ID.length > 0;
}

/** Validate that the URI is a genuine WalletConnect session URI before routing. */
export function isValidWalletConnectUri(uri: string) {
  return /^wc:[0-9a-f]{32}@2\?/.test(String(uri || "").trim());
}

export interface WcDeepLink {
  name: string;
  href: (uri: string) => string;
}

/** Deep-link builders for the most common mobile wallets (Reown-style routing). */
export const WC_DEEP_LINKS: WcDeepLink[] = [
  { name: "MetaMask", href: (uri) => `https://metamask.app.link/wc?uri=${encodeURIComponent(uri)}` },
  { name: "Coinbase Wallet", href: (uri) => `https://go.cb-w.com/wc?uri=${encodeURIComponent(uri)}` },
  { name: "Rainbow", href: (uri) => `https://rnbwapp.com/wc?uri=${encodeURIComponent(uri)}` },
  { name: "Trust Wallet", href: (uri) => `https://link.trustwallet.com/wc?uri=${encodeURIComponent(uri)}` },
  { name: "Zerion", href: (uri) => `https://zrni.to/wc?uri=${encodeURIComponent(uri)}` },
];

/** Route a session URI through the correct provider deep link, if available. */
export function routeWalletConnectSession(
  uri: string,
  walletName: string,
): string | null {
  const clean = String(uri || "").trim();
  if (!isWalletConnectConfigured() || !isValidWalletConnectUri(clean)) return null;
  const target = WC_DEEP_LINKS.find((entry) => entry.name.toLowerCase() === walletName.toLowerCase());
  return target ? target.href(clean) : null;
}

export interface MobileWalletInstall {
  name: string;
  blurb: string;
  href: string;
}

/** Public, stable install pages — safe to link directly. */
export const MOBILE_WALLET_INSTALLS: MobileWalletInstall[] = [
  { name: "MetaMask", blurb: "Multi-chain browser wallet", href: "https://metamask.io/download/" },
  { name: "Coinbase Wallet", blurb: "Self-custody soft + hardware wallet", href: "https://www.coinbase.com/wallet/" },
  { name: "Rainbow", blurb: "EVM wallet with built-in swaps", href: "https://rainbow.me/" },
  { name: "Trust Wallet", blurb: "DeFi + BNB chain wallet", href: "https://trustwallet.com/download/" },
  { name: "Zerion", blurb: "Portfolio + swap wallet", href: "https://zerion.io/" },
];