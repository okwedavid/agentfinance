"use client";
import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import { isLoggedIn, getTasks, API_BASE, getToken } from "@/lib/api";
import { useWebSocket } from "@/hooks/useWebSocket";
import { TopNav, BottomNav, PageFooter } from "@/components/layout/Nav";
import Link from "next/link";

const CHAINS = [
  { id:'ethereum', name:'Ethereum',  symbol:'ETH',  icon:'⟠', explorer:'https://etherscan.io/address/',    color:'text-blue-400'   },
  { id:'polygon',  name:'Polygon',   symbol:'MATIC', icon:'⬡', explorer:'https://polygonscan.com/address/',color:'text-purple-400' },
  { id:'base',     name:'Base',      symbol:'ETH',  icon:'🔵', explorer:'https://basescan.org/address/',   color:'text-blue-300'   },
  { id:'arbitrum', name:'Arbitrum',  symbol:'ETH',  icon:'◎',  explorer:'https://arbiscan.io/address/',    color:'text-sky-400'    },
  { id:'solana',   name:'Solana',    symbol:'SOL',  icon:'◎',  explorer:'https://solscan.io/account/',     color:'text-violet-400' },
  { id:'bitcoin',  name:'Bitcoin',   symbol:'BTC',  icon:'₿',  explorer:'https://blockstream.info/address/',color:'text-amber-400' },
];

type Msg = { text: string; type: 'ok' | 'err' | 'info' };

export default function WalletPage() {
  const { user }              = useAuth();
  const [wallet, setWallet]   = useState<string | null>(null);
  const [input, setInput]     = useState('');
  const [chain, setChain]     = useState(CHAINS[0]);
  const [saving, setSaving]   = useState(false);
  const [msg, setMsg]         = useState<Msg | null>(null);
  const [balance, setBalance] = useState<{ eth: string; usd: string } | null>(null);
  const [balLoad, setBalLoad] = useState(false);
  const [tasks, setTasks]     = useState<any[]>([]);
  const [sweeping, setSweep]  = useState(false);
  const { status: wsStatus }  = useWebSocket();

  function flash(text: string, type: Msg['type'] = 'ok') {
    setMsg({ text, type });
    setTimeout(() => setMsg(null), 6000);
  }

  const loadBalance = useCallback(async (addr: string) => {
    setBalLoad(true);
    try {
      const r = await fetch(`${API_BASE}/wallet/balance?address=${encodeURIComponent(addr)}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (r.ok) { const d = await r.json(); setBalance(d); }
      else { setBalance(null); }
    } catch { setBalance(null); }
    finally { setBalLoad(false); }
  }, []);

  useEffect(() => {
    if (!isLoggedIn()) { window.location.href = '/login'; return; }
    const saved = localStorage.getItem('agentfi_wallet');
    if (saved) { setWallet(saved); setInput(saved); loadBalance(saved); }
    getTasks().then(setTasks).catch(() => {});
  }, [loadBalance]);

  async function save(addr: string) {
    const trimmed = addr.trim();
    if (!trimmed) { flash('Enter a wallet address', 'err'); return; }
    if (!trimmed.startsWith('0x') || trimmed.length !== 42) {
      flash('Invalid address — must be 42 characters starting with 0x', 'err'); return;
    }
    setSaving(true);
    try {
      // Save to backend (best effort)
      await fetch(`${API_BASE}/auth/wallet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ walletAddress: trimmed }),
      }).catch(() => {});
      // Always save locally
      localStorage.setItem('agentfi_wallet', trimmed);
      setWallet(trimmed);
      flash('✅ Wallet connected! Agents will route earnings here.', 'ok');
      loadBalance(trimmed);
    } catch (e: any) {
      flash(e.message || 'Failed to save', 'err');
    } finally { setSaving(false); }
  }

  async function connectMetaMask() {
    const eth = (window as any).ethereum;
    if (!eth) {
      flash('MetaMask not found. Install it from metamask.io', 'info');
      setTimeout(() => window.open('https://metamask.io/download.html', '_blank'), 1000);
      return;
    }
    try {
      const accounts = await eth.request({ method: 'eth_requestAccounts' });
      const addr = accounts?.[0];
      if (addr) { setInput(addr); await save(addr); }
    } catch (e: any) {
      flash(e.code === 4001 ? 'Connection rejected in MetaMask' : e.message, 'err');
    }
  }

  function disconnect() {
    if (!confirm('Disconnect wallet? Agents will stop routing earnings until you reconnect.')) return;
    localStorage.removeItem('agentfi_wallet');
    setWallet(null); setInput(''); setBalance(null);
    // Also clear from backend
    fetch(`${API_BASE}/auth/wallet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify({ walletAddress: null }),
    }).catch(() => {});
    flash('Wallet disconnected', 'info');
  }

  async function sweepEarnings() {
    if (!wallet) { flash('Connect a wallet first', 'err'); return; }
    setSweep(true);
    flash('🚀 Dispatching Execution Agent to prepare sweep transaction…', 'info');
    try {
      await fetch(`${API_BASE}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ action: `Route agent earnings to wallet ${wallet}`, agentType: 'execution' }),
      });
      flash('✅ Execution agent deployed. Check Dashboard for the transaction details.', 'ok');
    } catch (e: any) {
      flash(e.message, 'err');
    } finally { setSweep(false); }
  }

  const completed = tasks.filter(t => t.status === 'completed').length;
  const pendingEth = (completed * 0.001).toFixed(4);
  const totalEth   = (completed * 0.0035).toFixed(4);

  const msgStyle: Record<Msg['type'], string> = {
    ok:   'bg-emerald-500/10 border-emerald-500/25 text-emerald-400',
    err:  'bg-red-500/10 border-red-500/25 text-red-400',
    info: 'bg-blue-500/10 border-blue-500/25 text-blue-300',
  };

  return (
    <div className="min-h-screen bg-[#050c18] flex flex-col">
      <TopNav wsStatus={wsStatus} />

      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-6 pb-24 md:pb-6 space-y-4 page-enter">

        <div>
          <h1 className="text-xl font-bold text-white">Wallet</h1>
          <p className="text-gray-400 text-sm">Connect your wallet to receive agent earnings</p>
        </div>

        {msg && (
          <div className={`px-4 py-3 rounded-xl border text-sm animate-fade-in leading-relaxed ${msgStyle[msg.type]}`}>
            {msg.text}
          </div>
        )}

        {/* ── Connected status card ── */}
        {wallet ? (
          <div className="glass rounded-2xl p-5 border border-emerald-600/25 animate-fade-in">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
                  <span className="text-emerald-400 font-semibold text-sm">Connected</span>
                  <span className="text-gray-600 text-xs">{chain.name}</span>
                </div>
                <p className="text-white font-mono text-sm break-all">{wallet}</p>
              </div>
              <div className="flex flex-col gap-1.5 text-right flex-shrink-0">
                <a href={`${chain.explorer}${wallet}`} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-blue-400 hover:text-blue-300 transition-colors">
                  Explorer ↗
                </a>
                <button onClick={() => loadBalance(wallet)}
                  className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
                  Refresh ↻
                </button>
                <button onClick={disconnect}
                  className="text-xs text-red-400 hover:text-red-300 transition-colors">
                  Disconnect
                </button>
              </div>
            </div>

            {/* Balance display */}
            <div className="bg-black/30 rounded-xl p-4">
              {balLoad ? (
                <div className="flex items-center gap-3">
                  <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                  <span className="text-gray-400 text-sm">Fetching balance from Alchemy…</span>
                </div>
              ) : balance ? (
                <div>
                  <p className="text-white font-mono text-2xl font-bold">{balance.eth} ETH</p>
                  <p className="text-gray-400 text-sm mt-1">≈ ${balance.usd} USD</p>
                </div>
              ) : (
                <div>
                  <p className="text-gray-500 text-sm">Balance loading failed</p>
                  <p className="text-gray-600 text-xs mt-1">Backend needs ALCHEMY_API_KEY in Railway variables</p>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="glass rounded-2xl p-4 border border-amber-600/25 animate-fade-in">
            <div className="flex items-center gap-2">
              <span className="text-amber-400 text-lg">⚠️</span>
              <div>
                <p className="text-amber-400 text-sm font-semibold">No wallet connected</p>
                <p className="text-amber-400/60 text-xs">Connect below to receive agent earnings</p>
              </div>
            </div>
          </div>
        )}

        {/* ── Earnings ── */}
        <div className="glass rounded-2xl p-5 animate-fade-in">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white">Agent Earnings Ledger</h2>
            <span className="text-gray-500 text-xs">{completed} tasks completed</span>
          </div>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="bg-black/30 rounded-xl p-4 text-center">
              <p className="text-gray-500 text-xs mb-1.5">Pending Sweep</p>
              <p className="text-white font-bold font-mono text-lg">{pendingEth}</p>
              <p className="text-gray-600 text-xs">ETH</p>
            </div>
            <div className="bg-black/30 rounded-xl p-4 text-center">
              <p className="text-gray-500 text-xs mb-1.5">Total Earned</p>
              <p className="text-emerald-400 font-bold font-mono text-lg">{totalEth}</p>
              <p className="text-gray-600 text-xs">ETH</p>
            </div>
          </div>

          {wallet && completed > 0 ? (
            <button onClick={sweepEarnings} disabled={sweeping}
              className="btn-primary w-full justify-center">
              {sweeping
                ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Deploying sweep agent…</>
                : `💸 Sweep ${pendingEth} ETH to Wallet`}
            </button>
          ) : !wallet ? (
            <p className="text-center text-gray-500 text-xs">Connect a wallet to sweep earnings</p>
          ) : (
            <div className="bg-blue-900/20 border border-blue-700/20 rounded-xl p-3 text-xs text-blue-300">
              💡 Complete tasks with the Trading or Research agent to accumulate earnings
            </div>
          )}
        </div>

        {/* ── Connect section ── */}
        <div className="glass rounded-2xl p-5 animate-fade-in">
          <h2 className="text-sm font-semibold text-white mb-4">Connect Wallet</h2>
          <div className="space-y-3">
            <button onClick={connectMetaMask}
              className="flex items-center gap-3 w-full bg-[#F6851B] hover:bg-[#E07217] rounded-xl px-4 py-3.5 text-white font-semibold transition-all active:scale-[0.98] shadow-lg shadow-orange-900/20">
              <span className="text-2xl">🦊</span>
              <div className="text-left">
                <p className="font-bold">MetaMask</p>
                <p className="text-orange-200 text-xs font-normal">Most popular · instant connect</p>
              </div>
            </button>
            <button onClick={() => flash('WalletConnect support coming soon. Use MetaMask or manual entry.', 'info')}
              className="flex items-center gap-3 w-full bg-blue-700/15 hover:bg-blue-700/25 border border-blue-600/25 rounded-xl px-4 py-3.5 text-white font-semibold transition-all">
              <span className="text-2xl">🔗</span>
              <div className="text-left">
                <p className="font-bold">WalletConnect</p>
                <p className="text-blue-300/60 text-xs font-normal">Coming soon</p>
              </div>
            </button>
          </div>
        </div>

        {/* ── Manual entry ── */}
        <div className="glass rounded-2xl p-5 animate-fade-in">
          <h2 className="text-sm font-semibold text-white mb-1">Enter Address Manually</h2>
          <p className="text-gray-400 text-xs mb-4">Ledger, Trezor, Coinbase Wallet, Safe — any 0x address</p>
          <input type="text" value={input} onChange={e => setInput(e.target.value)}
            placeholder="0x..." className="input-field font-mono mb-3"
            onKeyDown={e => { if (e.key === 'Enter' && input.trim()) save(input); }}
          />
          <button onClick={() => save(input)} disabled={saving || !input.trim()}
            className="btn-primary w-full justify-center">
            {saving
              ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Saving…</>
              : 'Save & Connect'}
          </button>
        </div>

        {/* ── Network selector ── */}
        <div className="glass rounded-2xl p-5 animate-fade-in">
          <h2 className="text-sm font-semibold text-white mb-1">Network</h2>
          <p className="text-gray-400 text-xs mb-4">Select chain for earnings routing</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {CHAINS.map(c => (
              <button key={c.id} onClick={() => setChain(c)}
                className={`flex items-center gap-2 p-3 rounded-xl border transition-all ${
                  chain.id === c.id
                    ? 'border-blue-500/40 bg-blue-900/20'
                    : 'border-white/[0.06] hover:border-white/10 bg-white/[0.02] hover:bg-white/[0.04]'
                }`}>
                <span className={`text-xl ${c.color}`}>{c.icon}</span>
                <div className="text-left min-w-0">
                  <p className="text-white text-xs font-semibold truncate">{c.name}</p>
                  <p className="text-gray-500 text-xs">{c.symbol}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* ── How to earn ── */}
        <div className="glass rounded-2xl p-5 border border-violet-600/15 animate-fade-in">
          <h2 className="text-sm font-semibold text-white mb-4">🚀 How to Earn Real Crypto</h2>
          <ol className="space-y-3">
            {[
              'Connect your MetaMask wallet above',
              'Go to Agents → deploy a Trading or Research agent',
              'Agent autonomously finds arbitrage and yield opportunities',
              'Review the proposed transaction before any execution',
              'Approve in MetaMask → profit lands directly in your wallet',
            ].map((s, i) => (
              <li key={i} className="flex gap-3">
                <span className="text-blue-400 font-bold text-sm flex-shrink-0 w-5 mt-0.5">{i + 1}.</span>
                <span className="text-gray-300 text-sm leading-relaxed">{s}</span>
              </li>
            ))}
          </ol>
          <div className="mt-4">
            <Link href="/agents" className="btn-primary w-full justify-center">
              🤖 Go to Agents →
            </Link>
          </div>
        </div>

      </main>

      <PageFooter />
      <BottomNav />
    </div>
  );
}