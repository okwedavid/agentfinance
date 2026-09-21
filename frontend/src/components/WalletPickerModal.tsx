"use client";
import { useEffect, useState } from "react";
import { useWallet } from "@/hooks/useWallet";
import {
  EIP6963ProviderDetail,
  isLikelyMobile,
} from "@/lib/wallets/eip6963";
import {
  isWalletConnectConfigured,
  MOBILE_WALLET_INSTALLS,
} from "@/lib/wallets/mobile";

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Explicit wallet picker. The user always selects the wallet to connect to —
 * there is no automatic `window.ethereum` fallback. On mobile with an empty
 * discovery list we surface install / WalletConnect options instead of a dead
 * button.
 */
export default function WalletPickerModal({ open, onClose }: Props) {
  const { providers, connect, disconnect, connectedAddress, status, error, providerName } = useWallet();
  const [justPicked, setJustPicked] = useState<string | null>(null);
  const mobile = isLikelyMobile();

  useEffect(() => {
    if (open && status !== "connecting") setJustPicked(null);
  }, [open, status]);

  if (!open) return null;

  const announced = providers as EIP6963ProviderDetail[];

  const switchWallet = async (rdns: string) => {
    setJustPicked(rdns);
    disconnect();
    setTimeout(() => connect(rdns), 60);
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full sm:max-w-sm bg-[#0f172a] border border-white/10 rounded-t-2xl sm:rounded-2xl p-5 shadow-2xl animate-scale-in">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-white font-semibold">Connect a wallet</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-xl leading-none" aria-label="Close">
            ×
          </button>
        </div>

        {status === "connecting" || justPicked ? (
          <div className="flex flex-col items-center justify-center gap-3 py-8">
            <div className="w-8 h-8 border-2 border-white/20 border-t-blue-500 rounded-full animate-spin" />
            <p className="text-sm text-gray-400">Waiting for the wallet to approve the connection…</p>
          </div>
        ) : (
          <>
            {error && (
              <div className="mb-4 px-3 py-2.5 bg-red-500/10 border border-red-500/25 rounded-xl text-red-300 text-xs leading-relaxed">
                {error}
              </div>
            )}

            {connectedAddress && (
              <div className="mb-4 flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
                <div className="min-w-0">
                  <div className="text-xs text-gray-500">Connected via {providerName || "wallet"}</div>
                  <div className="truncate font-mono text-sm text-green-300">
                    {connectedAddress.slice(0, 6)}…{connectedAddress.slice(-4)}
                  </div>
                </div>
                <button
                  onClick={disconnect}
                  className="flex-shrink-0 rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-1.5 text-xs text-rose-200 hover:bg-rose-400/15"
                >
                  Disconnect
                </button>
              </div>
            )}

            {announced.length > 0 ? (
              <ul className="space-y-2">
                {announced.map(({ info }) => (
                  <li key={info.rdns}>
                    <button
                      onClick={() => (connectedAddress ? switchWallet(info.rdns) : connect(info.rdns))}
                      className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-left transition hover:bg-white/[0.07]"
                    >
                      {info.icon ? (
                        <img src={info.icon} alt="" className="h-8 w-8 rounded-lg object-contain" />
                      ) : (
                        <span className="h-8 w-8 rounded-lg bg-white/10 flex items-center justify-center text-xs font-bold">
                          {(info.name || "W")[0].toUpperCase()}
                        </span>
                      )}
                      <span className="flex-1 text-sm font-medium text-white">{info.name}</span>
                      {connectedAddress && (
                        <span className="text-[11px] text-gray-500">switch</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-gray-400 leading-relaxed">
                  No installed browser wallet was detected on this device.
                  {mobile ? " Install one to connect from your phone:" : ""}
                </p>
                <div className="grid gap-2">
                  {MOBILE_WALLET_INSTALLS.map((wallet) => (
                    <a
                      key={wallet.name}
                      href={wallet.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-left transition hover:bg-white/[0.07]"
                    >
                      <span>
                        <span className="block text-sm font-medium text-white">{wallet.name}</span>
                        <span className="block text-xs text-gray-500">{wallet.name}</span>
                      </span>
                      <span className="text-xs text-cyan-300">Install →</span>
                    </a>
                  ))}
                </div>
                <p className="text-[11px] leading-relaxed text-gray-600">
                  {isWalletConnectConfigured()
                    ? "WalletConnect QR deep links light up automatically from the wallet page once a session starts."
                    : "WalletConnect mobile pairing is disabled until NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is set on the dashboard. You can still paste any address manually on the Wallet page."}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}