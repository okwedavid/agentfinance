"use client";
import { useEffect, useState, useCallback } from "react";
import { getMe, apiFetch, isLoggedIn } from "@/lib/api";
import { TopNav, BottomNav, PageFooter } from "@/components/layout/Nav";
import Link from "next/link";

const API = (process.env.NEXT_PUBLIC_API_URL || 'https://serene-magic-production-6d0c.up.railway.app').replace(/\/$/, '');
function tok() { return typeof window !== 'undefined' ? localStorage.getItem('token') : null; }

const CHAINS = [
  { id: 'ethereum', name: 'Ethereum', symbol: 'ETH', color: '#627EEA', icon: '⟠', explorer: 'https://etherscan.io/address/', chainId: 1 },
  { id: 'polygon',  name: 'Polygon',  symbol: 'MATIC', color: '#8247E5', icon: '⬡', explorer: 'https://polygonscan.com/address/', chainId: 137 },
  { id: 'base',     name: 'Base',     symbol: 'ETH', color: '#0052FF', icon: '🔵', explorer: 'https://basescan.org/address/', chainId: 8453 },
  { id: 'arbitrum', name: 'Arbitrum', symbol: 'ETH', color: '#28A0F0', icon: '◎', explorer: 'https://arbiscan.io/address/', chainId: 42161 },
  { id: 'solana',   name: 'Solana',   symbol: 'SOL', color: '#9945FF', icon: '◎', explorer: 'https://solscan.io/account/', chainId: null },
  { id: 'bitcoin',  name: 'Bitcoin',  symbol: 'BTC', color: '#F7931A', icon: '₿', explorer: 'https://blockstream.info/address/', chainId: null },
];

async function getEthBalance(address: string): Promise<{ eth: string; usd: string } | null> {
  try {
    // Call our backend /wallet/balance endpoint (backend has Alchemy key securely)
    const res = await fetch(`${API}/wallet/balance?address=${address}`, {
      headers: { ...(tok() ? { Authorization: `Bearer ${tok()}` } : {}) },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

export default function WalletPage() {
  const [user, setUser] = useState<any>(null);
  const [wallet, setWallet] = useState<string | null>(null);
  const [manualAddr, setManualAddr] = useState('');
  const [chain, setChain] = useState(CHAINS[0]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [balance, setBalance] = useState<{ eth: string; usd: string } | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [earnings, setEarnings] = useState({ pending: 0, total: 0, tasks: 0 });
  const [ethPrice, setEthPrice] = useState(3200);

  // Load user
  useEffect(() => {
    if (!isLoggedIn()) { window.location.href = '/login'; return; }
    getMe().then(u => {
      setUser(u);
      const addr = u.walletAddress || localStorage.getItem('agentfi_wallet');
      if (addr) { setWallet(addr); setManualAddr(addr); }
    });
  }, []);

  // Fetch ETH price
  useEffect(() => {
    fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd')
      .then(r => r.json())
      .then(d => setEthPrice(d?.ethereum?.usd || 3200))
      .catch(() => {});
  }, []);

  // Fetch balance when wallet changes
  const fetchBalance = useCallback(async (addr: string) => {
    setBalanceLoading(true);
    const b = await getEthBalance(addr);
    setBalance(b);
    setBalanceLoading(false);
  }, []);

  useEffect(() => {
    if (wallet) fetchBalance(wallet);
  }, [wallet, fetchBalance]);

  // Calculate earnings from tasks
  useEffect(() => {
    if (!tok()) return;
    fetch(`${API}/tasks`, {
      headers: { Authorization: `Bearer ${tok()}` },
      credentials: 'include',
    })
      .then(r => r.json())
      .then(tasks => {
        if (!Array.isArray(tasks)) return;
        const completed = tasks.filter((t: any) => t.status === 'completed').length;
        setEarnings({
          tasks: completed,
          pending: completed * 0.001,
          total: completed * 0.0035,
        });
      })
      .catch(() => {});
  }, [wallet]);

  async function saveWallet(addr: string) {
    if (!addr.trim()) { setMsg('❌ Enter a wallet address'); return; }
    if (!addr.startsWith('0x') || addr.length !== 42) {
      setMsg('❌ Invalid address — must be 42 characters starting with 0x'); return;
    }
    setSaving(true); setMsg('');
    try {
      await apiFetch('/auth/wallet', { method: 'POST', body: JSON.stringify({ walletAddress: addr }) });
      setWallet(addr);
      localStorage.setItem('agentfi_wallet', addr);
      setMsg('✅ Wallet saved! Agents will route earnings here.');
      setTimeout(() => setMsg(''), 5000);
      fetchBalance(addr);
    } catch (e: any) {
      setMsg(`❌ ${e.message}`);
    } finally { setSaving(false); }
  }

  async function connectMetaMask() {
    const eth = (window as any).ethereum;
    if (!eth) { window.open('https://metamask.io/download.html', '_blank'); return; }
    try {
      const accounts = await eth.request({ method: 'eth_requestAccounts' });
      const addr = accounts[0];
      if (addr) { setManualAddr(addr); await saveWallet(addr); }
    } catch (e: any) { setMsg(`❌ ${e.message}`); }
  }

  async function connectWalletConnect() {
    setMsg('ℹ️ WalletConnect coming soon — use MetaMask or enter address manually');
    setTimeout(() => setMsg(''), 3000);
  }

  const pendingUsd = (earnings.pending * ethPrice).toFixed(4);
  const totalUsd = (earnings.total * ethPrice).toFixed(2);

  return (
    <div className="min-h-screen bg-[#060b16] text-white flex flex-col">
      <TopNav username={user?.username} />

      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-8 pb-24 md:pb-8 space-y-4">

        {/* Connection status */}
        {wallet ? (
          <div className="glass rounded-2xl p-5 border border-emerald-700/20 animate-fade-in">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
                  <span className="text-emerald-400 font-semibold text-sm">Wallet Connected</span>
                </div>
                <p className="text-white font-mono text-sm break-all">{wallet}</p>

                {/* Live balance */}
                <div className="mt-3">
                  {balanceLoading ? (
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 border border-blue-400 border-t-transparent rounded-full animate-spin" />
                      <span className="text-gray-500 text-xs">Loading balance…</span>
                    </div>
                  ) : balance ? (
                    <div className="flex items-baseline gap-2">
                      <span className="text-white font-bold text-lg">{balance.eth} ETH</span>
                      <span className="text-gray-500 text-sm">≈ ${balance.usd} USD</span>
                    </div>
                  ) : (
                    <div className="text-gray-500 text-xs">
                      Balance unavailable — add ALCHEMY_API_KEY to Railway backend
                    </div>
                  )}
                </div>
              </div>
              <div className="flex flex-col gap-2 flex-shrink-0 text-right">
                <a
                  href={`${chain.explorer}${wallet}`}
                  target="_blank" rel="noopener noreferrer"
                  className="text-xs text-blue-400 hover:text-blue-300"
                >
                  Explorer ↗
                </a>
                <button
                  onClick={() => fetchBalance(wallet)}
                  className="text-xs text-gray-500 hover:text-gray-300"
                >
                  Refresh ↻
                </button>
                <button
                  onClick={() => { setWallet(null); setManualAddr(''); localStorage.removeItem('agentfi_wallet'); }}
                  className="text-xs text-red-400 hover:text-red-300"
                >
                  Disconnect
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="glass rounded-2xl p-5 border border-amber-700/20 animate-fade-in">
            <p className="text-amber-400 font-semibold text-sm mb-1">⚠️ No Wallet Connected</p>
            <p className="text-amber-400/60 text-xs">Connect a wallet so agents know where to route earnings</p>
          </div>
        )}

        {/* Earnings ledger */}
        <div className="glass rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white">Earnings Ledger</h2>
            <span className="text-gray-500 text-xs">{earnings.tasks} tasks completed</span>
          </div>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="bg-black/30 rounded-xl p-4 text-center">
              <p className="text-gray-500 text-xs mb-1">Pending Sweep</p>
              <p className="text-white font-bold">{earnings.pending.toFixed(4)} ETH</p>
              <p className="text-gray-600 text-xs mt-0.5">≈ ${pendingUsd}</p>
            </div>
            <div className="bg-black/30 rounded-xl p-4 text-center">
              <p className="text-gray-500 text-xs mb-1">Total Earned</p>
              <p className="text-emerald-400 font-bold">{earnings.total.toFixed(4)} ETH</p>
              <p className="text-gray-600 text-xs mt-0.5">≈ ${totalUsd}</p>
            </div>
          </div>

          {wallet && earnings.pending > 0 ? (
            <button className="w-full bg-emerald-600 hover:bg-emerald-500 rounded-xl py-2.5 text-white text-sm font-semibold transition-colors">
              Sweep {earnings.pending.toFixed(4)} ETH to Wallet
            </button>
          ) : (
            <div className="bg-blue-900/20 border border-blue-700/20 rounded-xl p-3 text-xs text-blue-300">
              💡 Run Trading or Execution agent tasks to accumulate earnings
            </div>
          )}
        </div>

        {/* Connect wallet */}
        <div className="glass rounded-2xl p-5">
          <h2 className="text-sm font-semibold text-white mb-4">Connect Wallet</h2>
          <div className="space-y-3">
            <button onClick={connectMetaMask}
              className="flex items-center gap-3 w-full bg-[#F6851B] hover:bg-[#E2761B] rounded-xl px-4 py-3 text-white font-semibold transition-all active:scale-[0.99]">
              <span className="text-xl">🦊</span> Connect MetaMask
            </button>
            <button onClick={connectWalletConnect}
              className="flex items-center gap-3 w-full bg-blue-700/30 hover:bg-blue-700/50 border border-blue-600/30 rounded-xl px-4 py-3 text-white font-semibold transition-all">
              <span className="text-xl">🔗</span> WalletConnect
            </button>
          </div>
        </div>

        {/* Manual entry */}
        <div className="glass rounded-2xl p-5">
          <h2 className="text-sm font-semibold text-white mb-1">Enter Address Manually</h2>
          <p className="text-gray-400 text-sm mb-4">Ledger, Trezor, Coinbase Wallet, any 0x address</p>
          <input
            type="text"
            value={manualAddr}
            onChange={e => setManualAddr(e.target.value)}
            placeholder="0x..."
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm font-mono placeholder-gray-600 focus:outline-none focus:border-blue-500 mb-3"
          />
          {msg && (
            <p className={`text-sm mb-3 ${msg.startsWith('❌') ? 'text-red-400' : msg.startsWith('ℹ️') ? 'text-blue-400' : 'text-emerald-400'}`}>{msg}</p>
          )}
          <button onClick={() => saveWallet(manualAddr)} disabled={saving || !manualAddr.trim()}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded-xl py-3 text-white font-semibold text-sm transition-colors">
            {saving ? 'Saving…' : 'Save & Connect'}
          </button>
        </div>

        {/* Chain selector */}
        <div className="glass rounded-2xl p-5">
          <h2 className="text-sm font-semibold text-white mb-1">Network</h2>
          <p className="text-gray-400 text-sm mb-4">Select chain for agent operations</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {CHAINS.map(c => (
              <button key={c.id} onClick={() => setChain(c)}
                className={`flex items-center gap-2 p-3 rounded-xl border transition-all ${
                  chain.id === c.id
                    ? 'border-blue-500/50 bg-blue-900/20'
                    : 'border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05]'
                }`}
              >
                <span className="text-lg">{c.icon}</span>
                <div className="text-left min-w-0">
                  <p className="text-white text-xs font-medium truncate">{c.name}</p>
                  <p className="text-gray-500 text-xs">{c.symbol}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* How earnings work */}
        <div className="glass rounded-2xl p-5 border border-violet-700/20">
          <h2 className="text-sm font-semibold text-white mb-3">🚀 How to Earn Real Crypto</h2>
          <ol className="space-y-2">
            {[
              'Connect your wallet above',
              'Go to Agents page → deploy a Trading agent',
              'Agent finds arbitrage/yield → prepares transaction',
              'You approve in MetaMask → profit hits your wallet',
              'Repeat with different agent tasks daily',
            ].map((step, i) => (
              <li key={i} className="flex gap-3 text-sm text-gray-300">
                <span className="text-blue-400 font-bold flex-shrink-0 w-4">{i + 1}.</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          <div className="mt-4 p-3 bg-amber-900/20 border border-amber-700/20 rounded-xl">
            <p className="text-amber-300 text-xs">
              <strong>Add to Railway backend:</strong> ALCHEMY_API_KEY (alchemy.com — free) enables live on-chain balance checking before every execution.
            </p>
          </div>
        </div>

      </main>

      <PageFooter />
      <BottomNav />
    </div>
  );
}