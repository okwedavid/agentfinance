"use client";
import { useEffect, useState } from "react";
import { getMe, apiFetch, isLoggedIn } from "@/lib/api";
import Link from "next/link";

const CHAINS = [
  { id: 'ethereum', name: 'Ethereum', symbol: 'ETH', color: '#627EEA', icon: '⟠' },
  { id: 'polygon',  name: 'Polygon',  symbol: 'MATIC', color: '#8247E5', icon: '⬡' },
  { id: 'base',     name: 'Base',     symbol: 'ETH', color: '#0052FF', icon: '🔵' },
  { id: 'arbitrum', name: 'Arbitrum', symbol: 'ETH', color: '#28A0F0', icon: '◎' },
  { id: 'solana',   name: 'Solana',   symbol: 'SOL', color: '#9945FF', icon: '◎' },
  { id: 'bitcoin',  name: 'Bitcoin',  symbol: 'BTC', color: '#F7931A', icon: '₿' },
];

const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'https://serene-magic-production-6d0c.up.railway.app').replace(/\/$/, '');

export default function WalletPage() {
  const [user, setUser] = useState<any>(null);
  const [connectedAddress, setConnectedAddress] = useState<string | null>(null);
  const [selectedChain, setSelectedChain] = useState(CHAINS[0]);
  const [manualAddress, setManualAddress] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [metamaskInstalled, setMetamaskInstalled] = useState(false);

  useEffect(() => {
    if (!isLoggedIn()) { window.location.href = '/login'; return; }
    getMe().then(u => {
      setUser(u);
      if (u.walletAddress) {
        setConnectedAddress(u.walletAddress);
        setManualAddress(u.walletAddress);
      }
    });
    setMetamaskInstalled(!!(window as any).ethereum);
    const stored = localStorage.getItem('agentfi_wallet');
    if (stored) setConnectedAddress(stored);
  }, []);

  const connectMetaMask = async () => {
    const eth = (window as any).ethereum;
    if (!eth) { window.open('https://metamask.io/download.html', '_blank'); return; }
    try {
      const accounts = await eth.request({ method: 'eth_requestAccounts' });
      const addr = accounts[0];
      if (addr) {
        localStorage.setItem('agentfi_wallet', addr);
        setConnectedAddress(addr);
        setManualAddress(addr);
        await saveAddress(addr);
      }
    } catch (e) { console.error(e); }
  };

  const saveAddress = async (addr: string) => {
    if (!addr.startsWith('0x') || addr.length !== 42) {
      setSaveMsg('❌ Invalid Ethereum address');
      return;
    }
    setSaving(true);
    setSaveMsg('');
    try {
      await apiFetch('/auth/wallet', { method: 'POST', body: JSON.stringify({ walletAddress: addr }) });
      setConnectedAddress(addr);
      setSaveMsg('✅ Wallet saved — earnings will be sent here');
      setTimeout(() => setSaveMsg(''), 4000);
    } catch (e: any) {
      setSaveMsg(`❌ ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const disconnect = () => {
    localStorage.removeItem('agentfi_wallet');
    setConnectedAddress(null);
    setManualAddress('');
    setSaveMsg('Wallet disconnected');
    setTimeout(() => setSaveMsg(''), 2000);
  };

  return (
    <div className="min-h-screen bg-[#080d1a]">
      {/* Header */}
      <header className="border-b border-white/5 bg-black/40 backdrop-blur sticky top-0 z-30">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link href="/dashboard" className="text-gray-400 hover:text-white text-sm transition-colors">← Dashboard</Link>
          <span className="text-white font-bold flex-1 text-center">Wallet</span>
          <Link href="/analytics" className="text-gray-400 hover:text-white text-sm transition-colors">Analytics</Link>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-5">

        {/* Connected wallet banner */}
        {connectedAddress ? (
          <div className="bg-emerald-900/20 border border-emerald-700/40 rounded-2xl p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-emerald-400 font-semibold text-sm mb-1">✅ Wallet connected</p>
                <p className="text-white font-mono text-sm break-all">{connectedAddress}</p>
                <p className="text-emerald-400/70 text-xs mt-2">Agent earnings will be swept to this address automatically</p>
              </div>
              <button onClick={disconnect} className="text-xs text-red-400 hover:text-red-300 bg-red-900/20 border border-red-800/30 px-3 py-1.5 rounded-lg flex-shrink-0">
                Disconnect
              </button>
            </div>
          </div>
        ) : (
          <div className="bg-amber-900/20 border border-amber-700/40 rounded-2xl p-5">
            <p className="text-amber-400 font-semibold text-sm mb-1">⚠️ No wallet connected</p>
            <p className="text-amber-400/70 text-xs">Connect a wallet so your agents know where to send earnings</p>
          </div>
        )}

        {/* MetaMask connect */}
        <div className="bg-white/4 border border-white/8 rounded-2xl p-5">
          <h2 className="text-white font-semibold mb-1">Connect MetaMask</h2>
          <p className="text-gray-400 text-sm mb-4">One-click connect with your browser wallet</p>
          <button
            onClick={connectMetaMask}
            className="flex items-center gap-3 w-full bg-[#F6851B] hover:bg-[#E2761B] active:scale-[0.98] transition-all rounded-xl px-4 py-3 text-white font-semibold"
          >
            <span className="text-2xl">🦊</span>
            <span>{metamaskInstalled ? 'Connect MetaMask' : 'Install MetaMask'}</span>
          </button>
        </div>

        {/* Manual address entry */}
        <div className="bg-white/4 border border-white/8 rounded-2xl p-5">
          <h2 className="text-white font-semibold mb-1">Enter wallet address manually</h2>
          <p className="text-gray-400 text-sm mb-4">Any Ethereum-compatible (0x…) address. Hardware wallets, Coinbase, etc.</p>

          <input
            type="text"
            value={manualAddress}
            onChange={e => setManualAddress(e.target.value)}
            placeholder="0x..."
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm font-mono placeholder-gray-600 focus:outline-none focus:border-blue-500 transition-colors mb-3"
          />

          {saveMsg && (
            <p className={`text-sm mb-3 ${saveMsg.startsWith('❌') ? 'text-red-400' : 'text-emerald-400'}`}>{saveMsg}</p>
          )}

          <button
            onClick={() => saveAddress(manualAddress)}
            disabled={saving || !manualAddress}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl py-3 text-white font-semibold text-sm transition-colors"
          >
            {saving ? 'Saving...' : 'Save Address'}
          </button>
        </div>

        {/* Supported chains */}
        <div className="bg-white/4 border border-white/8 rounded-2xl p-5">
          <h2 className="text-white font-semibold mb-1">Supported networks</h2>
          <p className="text-gray-400 text-sm mb-4">AgentFinance agents can operate across these chains</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {CHAINS.map(chain => (
              <button
                key={chain.id}
                onClick={() => setSelectedChain(chain)}
                className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                  selectedChain.id === chain.id
                    ? 'border-blue-500/60 bg-blue-900/20'
                    : 'border-white/8 bg-white/3 hover:bg-white/6'
                }`}
              >
                <span className="text-xl">{chain.icon}</span>
                <div className="text-left min-w-0">
                  <p className="text-white text-sm font-medium truncate">{chain.name}</p>
                  <p className="text-gray-500 text-xs">{chain.symbol}</p>
                </div>
              </button>
            ))}
          </div>
          <p className="text-gray-600 text-xs mt-4">
            Selected: <span className="text-gray-400">{selectedChain.name}</span> — agents default to Ethereum mainnet unless instructed otherwise
          </p>
        </div>

        {/* Internal wallet note */}
        <div className="bg-white/4 border border-white/8 rounded-2xl p-5">
          <h2 className="text-white font-semibold mb-1">🏦 Platform earnings ledger</h2>
          <p className="text-gray-400 text-sm mb-3">
            All income generated by your agents is tracked on-platform before sweeping to your wallet.
            On-chain execution requires explicit approval for every transaction.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-black/30 rounded-xl p-3 text-center">
              <p className="text-gray-500 text-xs mb-1">Pending sweep</p>
              <p className="text-white font-bold">$0.00</p>
            </div>
            <div className="bg-black/30 rounded-xl p-3 text-center">
              <p className="text-gray-500 text-xs mb-1">Total earned</p>
              <p className="text-emerald-400 font-bold">$0.00</p>
            </div>
          </div>
          <p className="text-gray-600 text-xs mt-3">
            Connect your wallet and run trading/execution agents to start accumulating earnings.
          </p>
        </div>

      </main>
    </div>
  );
}