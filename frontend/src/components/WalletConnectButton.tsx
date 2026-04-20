'use client';
import { useEffect, useState } from 'react';

const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'https://serene-magic-production-6d0c.up.railway.app').replace(/\/$/, '');

export default function WalletConnectButton() {
  const [addr, setAddr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const s = localStorage.getItem('agentfi_wallet');
    if (s) setAddr(s);
    if ((window as any).ethereum?.selectedAddress) {
      setAddr((window as any).ethereum.selectedAddress);
    }
  }, []);

  async function saveWalletToBackend(address: string) {
    const token = localStorage.getItem('token');
    if (!token) return;
    setSaving(true);
    try {
      await fetch(`${API_URL}/auth/wallet`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ walletAddress: address }),
      });
    } catch (e) {
      console.warn('Could not save wallet to backend:', e);
    } finally {
      setSaving(false);
    }
  }

  const connect = async () => {
    try {
      const eth = (window as any).ethereum;
      if (!eth) {
        window.open('https://metamask.io', '_blank');
        return;
      }
      const accounts = await eth.request({ method: 'eth_requestAccounts' });
      const a = accounts?.[0];
      if (a) {
        localStorage.setItem('agentfi_wallet', a);
        setAddr(a);
        await saveWalletToBackend(a);
      }
    } catch (err) {
      console.error('wallet connect', err);
    }
  };

  const disconnect = () => {
    localStorage.removeItem('agentfi_wallet');
    setAddr(null);
  };

  return addr ? (
    <div className="flex items-center gap-2">
      <div className="bg-gray-800 px-3 py-1 rounded text-sm text-green-400 font-mono">
        {saving ? 'Saving...' : `${addr.slice(0, 6)}...${addr.slice(-4)}`}
      </div>
      <button onClick={disconnect} className="px-2 py-1 bg-red-600 rounded text-sm">
        Disconnect
      </button>
    </div>
  ) : (
    <button onClick={connect} className="px-3 py-1 bg-indigo-600 rounded text-sm hover:bg-indigo-500">
      Connect Wallet
    </button>
  );
}