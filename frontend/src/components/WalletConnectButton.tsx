"use client";
import { useState } from "react";
import { useWallet } from "@/hooks/useWallet";
import WalletPickerModal from "./WalletPickerModal";

export default function WalletConnectButton() {
  const { address, syncingToBackend } = useWallet();
  const [open, setOpen] = useState(false);

  return (
    <>
      {address ? (
        <div className="flex items-center gap-2">
          <button
            onClick={() => setOpen(true)}
            title="Change or disconnect wallet"
            className="bg-gray-800 px-3 py-1 rounded text-sm text-green-400 font-mono hover:bg-gray-700 transition-colors"
          >
            {syncingToBackend ? "Syncing…" : `${address.slice(0, 6)}…${address.slice(-4)}`}
          </button>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="flex-shrink-0 bg-indigo-600 hover:bg-indigo-500 active:scale-95 transition-all rounded-lg px-3 py-1.5 text-white text-xs font-semibold whitespace-nowrap"
        >
          Connect Wallet
        </button>
      )}
      <WalletPickerModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}