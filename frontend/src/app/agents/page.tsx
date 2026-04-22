"use client";
import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { isLoggedIn, createTask, getTasks, API_BASE, getToken } from "@/lib/api";
import { useWebSocket } from "@/hooks/useWebSocket";
import { TopNav, BottomNav, PageFooter } from "@/components/layout/Nav";
import Link from "next/link";

const AGENTS = [
  {
    id: 'research',
    name: 'Research Agent',
    icon: '🔬',
    status: 'online' as const,
    badge: 'Most Active',
    badgeColor: 'bg-blue-500/15 text-blue-300 border-blue-500/25',
    cardGlow: 'hover:border-blue-500/30',
    desc: 'Scans markets 24/7 for opportunities. Analyses DeFi yields, trending coins, risk signals and sentiment across 40+ data sources.',
    capabilities: ['Market analysis', 'Yield comparison', 'Trend detection', 'Risk scoring', 'Sentiment analysis'],
    tasks: [
      'Find the best DeFi yield opportunities right now',
      'Research the top 5 trending coins this week',
      'Analyse current crypto market sentiment',
      'Find passive income opportunities in DeFi',
      'Research Ethereum layer 2 yield farming rates',
    ],
  },
  {
    id: 'trading',
    name: 'Trading Agent',
    icon: '📈',
    status: 'online' as const,
    badge: 'High Yield',
    badgeColor: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25',
    cardGlow: 'hover:border-emerald-500/30',
    desc: 'Identifies arbitrage between exchanges, finds yield farming opportunities, calculates position sizes and manages execution risk.',
    capabilities: ['Arbitrage detection', 'Yield farming', 'Position sizing', 'Risk management', 'Cross-DEX routing'],
    tasks: [
      'Check ETH arbitrage opportunities across major exchanges',
      'Find the highest APY stablecoin yield right now',
      'Analyse BTC trading opportunity this week',
      'Compare Uniswap vs Curve stablecoin yields',
      'Find best ETH staking options by APY',
    ],
  },
  {
    id: 'content',
    name: 'Content Agent',
    icon: '✍️',
    status: 'online' as const,
    badge: 'Passive Income',
    badgeColor: 'bg-violet-500/15 text-violet-300 border-violet-500/25',
    cardGlow: 'hover:border-violet-500/30',
    desc: 'Writes monetisable crypto content — newsletters, articles, Twitter threads, YouTube scripts — all ready to publish and earn.',
    capabilities: ['Newsletter writing', 'Thread creation', 'Market reports', 'Article writing', 'Video scripts'],
    tasks: [
      'Write a crypto market newsletter for this week',
      'Create a Twitter thread explaining DeFi to beginners',
      'Write a research report on Solana ecosystem',
      'Draft a YouTube script about crypto passive income',
      'Write a blog post about the best crypto strategies 2025',
    ],
  },
  {
    id: 'execution',
    name: 'Execution Agent',
    icon: '⚡',
    status: 'online' as const,
    badge: 'On-Chain',
    badgeColor: 'bg-amber-500/15 text-amber-300 border-amber-500/25',
    cardGlow: 'hover:border-amber-500/30',
    desc: 'Prepares on-chain transactions, checks balances, routes earnings. Always shows you what it will do before execution.',
    capabilities: ['Balance checking', 'Transaction prep', 'Profit routing', 'Gas estimation', 'Multi-chain support'],
    tasks: [
      'Check my wallet balance on Ethereum',
      'Prepare ETH transfer to my wallet address',
      'Route agent earnings to my connected wallet',
      'Check current gas fees and best time to transact',
      'Calculate optimal swap route for 1 ETH to USDC',
    ],
  },
  {
    id: 'social',
    name: 'Social Agent',
    icon: '📱',
    status: 'coming-soon' as const,
    badge: 'Coming Soon',
    badgeColor: 'bg-gray-700 text-gray-400 border-gray-600',
    cardGlow: '',
    desc: 'Posts content to TikTok, YouTube, Facebook, X automatically. Grows your audience and monetises your crypto knowledge.',
    capabilities: ['TikTok posting', 'YouTube uploads', 'X/Twitter automation', 'Facebook pages', 'Audience growth'],
    tasks: [],
  },
  {
    id: 'security',
    name: 'Security Agent',
    icon: '🛡️',
    status: 'coming-soon' as const,
    badge: 'Coming Soon',
    badgeColor: 'bg-gray-700 text-gray-400 border-gray-600',
    cardGlow: '',
    desc: 'Monitors for rug pulls, phishing attempts, suspicious transactions and wallet drainer contracts. Keeps your assets safe.',
    capabilities: ['Rug pull detection', 'Phishing alerts', 'Wallet monitoring', 'Contract auditing', 'Threat scoring'],
    tasks: [],
  },
  {
    id: 'miner',
    name: 'Mining Agent',
    icon: '⛏️',
    status: 'coming-soon' as const,
    badge: 'Coming Soon',
    badgeColor: 'bg-gray-700 text-gray-400 border-gray-600',
    cardGlow: '',
    desc: 'Monitors mining operations, tracks hashrate, switches between profitable pools, calculates power vs earnings ratio.',
    capabilities: ['Pool monitoring', 'Hashrate tracking', 'Profitability calc', 'Pool auto-switching', 'Hardware alerts'],
    tasks: [],
  },
  {
    id: 'collab',
    name: 'Collaboration Agent',
    icon: '🤝',
    status: 'coming-soon' as const,
    badge: 'Coming Soon',
    badgeColor: 'bg-gray-700 text-gray-400 border-gray-600',
    cardGlow: '',
    desc: 'Connects your agents with other users\' agents to find joint income opportunities. Split profits automatically via smart contracts.',
    capabilities: ['Agent networking', 'Profit sharing', 'Joint strategies', 'P2P arbitrage', 'Shared liquidity'],
    tasks: [],
  },
];

export default function AgentsPage() {
  const { user } = useAuth();
  const [launching, setLaunching] = useState<string | null>(null);
  const [successTask, setSuccessTask] = useState<string | null>(null);
  const [taskCounts, setTaskCounts] = useState<Record<string, number>>({});
  const { status: wsStatus } = useWebSocket();

  useEffect(() => {
    if (!isLoggedIn()) { window.location.href = '/login'; return; }
    // Get task counts per agent type to show activity
    getTasks().then(tasks => {
      const counts: Record<string, number> = {};
      tasks.forEach((t: any) => {
        try {
          const r = JSON.parse(t.result || '{}');
          const type = r.agentType || 'research';
          counts[type] = (counts[type] || 0) + 1;
        } catch {}
      });
      setTaskCounts(counts);
    }).catch(() => {});
  }, []);

  async function launch(task: string) {
    setLaunching(task);
    try {
      await createTask(task);
      setSuccessTask(task);
      setTimeout(() => setSuccessTask(null), 4000);
      window.dispatchEvent(new CustomEvent('task:created'));
    } catch (e: any) {
      const msg = e.message || 'Failed';
      if (msg.includes('localhost') || msg.includes('fetch')) {
        alert('❌ API URL misconfigured. Go to Railway → Frontend → Variables → change NEXT_PUBLIC_API_URL to: https://serene-magic-production-6d0c.up.railway.app');
      } else {
        alert('❌ ' + msg);
      }
    } finally {
      setLaunching(null);
    }
  }

  return (
    <div className="min-h-screen bg-[#050c18] flex flex-col">
      <TopNav wsStatus={wsStatus} />

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-6 pb-24 md:pb-6 page-enter">

        <div className="mb-6 animate-fade-in">
          <h1 className="text-2xl font-bold text-white">Agent Fleet</h1>
          <p className="text-gray-400 text-sm mt-1">
            AI agents working 24/7 to generate income for you
          </p>
        </div>

        {successTask && (
          <div className="mb-4 bg-emerald-900/20 border border-emerald-700/30 rounded-xl px-4 py-3 text-emerald-400 text-sm animate-fade-in flex items-center justify-between">
            <span>✅ Agent deployed: <span className="text-white">{successTask.slice(0, 55)}…</span></span>
            <Link href="/dashboard" className="underline text-xs">View →</Link>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 stagger-children">
          {AGENTS.map((agent, i) => (
            <div
              key={agent.id}
              className={`glass rounded-2xl overflow-hidden flex flex-col transition-all duration-300 animate-fade-in border border-white/[0.07] ${agent.cardGlow} ${
                agent.status === 'online' ? 'card-glow' : 'opacity-70'
              }`}
              style={{ animationDelay: `${i * 55}ms` }}
            >
              {/* Card header */}
              <div className="p-5 flex-1">
                <div className="flex items-start justify-between mb-3">
                  <div className="w-12 h-12 rounded-xl bg-white/[0.04] border border-white/[0.07] flex items-center justify-center text-2xl">
                    {agent.icon}
                  </div>
                  <span className={`text-[10px] font-semibold px-2 py-1 rounded-full border ${agent.badgeColor}`}>
                    {agent.badge}
                  </span>
                </div>

                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-white font-bold text-sm">{agent.name}</h3>
                </div>

                <div className="flex items-center gap-1.5 mb-3">
                  <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                    agent.status === 'online' ? 'bg-emerald-400 animate-pulse' : 'bg-gray-600'
                  }`} />
                  <span className={`text-xs ${agent.status === 'online' ? 'text-emerald-400' : 'text-gray-500'}`}>
                    {agent.status === 'online' ? 'Online' : 'Coming soon'}
                  </span>
                  {taskCounts[agent.id] > 0 && (
                    <span className="text-gray-600 text-xs ml-auto">
                      {taskCounts[agent.id]} runs
                    </span>
                  )}
                </div>

                <p className="text-gray-400 text-xs leading-relaxed mb-3">{agent.desc}</p>

                {/* Capability chips */}
                <div className="flex flex-wrap gap-1 mb-3">
                  {agent.capabilities.slice(0, 3).map(c => (
                    <span key={c} className="text-[10px] bg-white/[0.04] border border-white/[0.07] rounded-md px-2 py-0.5 text-gray-500">
                      {c}
                    </span>
                  ))}
                  {agent.capabilities.length > 3 && (
                    <span className="text-[10px] text-gray-600">+{agent.capabilities.length - 3}</span>
                  )}
                </div>
              </div>

              {/* Tasks / actions */}
              {agent.status === 'online' ? (
                <div className="border-t border-white/[0.06] p-3 space-y-1.5 bg-black/10">
                  <p className="text-gray-600 text-[10px] uppercase tracking-wide font-semibold px-1 mb-2">
                    Quick deploy
                  </p>
                  {agent.tasks.map(task => (
                    <button
                      key={task}
                      onClick={() => launch(task)}
                      disabled={launching === task}
                      className="w-full text-left flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-xs text-gray-300 hover:text-white bg-white/[0.02] hover:bg-white/[0.07] border border-transparent hover:border-white/[0.08] transition-all disabled:opacity-40 group"
                    >
                      <span className="line-clamp-1 flex-1">{task}</span>
                      {launching === task ? (
                        <div className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin flex-shrink-0" />
                      ) : (
                        <span className="text-gray-600 group-hover:text-white transition-colors flex-shrink-0">▶</span>
                      )}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="border-t border-white/[0.06] p-4 bg-black/10">
                  <p className="text-gray-600 text-xs text-center mb-3">In development</p>
                  <button className="w-full text-xs bg-white/[0.03] border border-white/[0.06] rounded-xl px-3 py-2 text-gray-500 hover:text-gray-300 hover:bg-white/[0.06] transition-all">
                    Get notified when ready
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* How it works */}
        <div className="mt-8 glass rounded-2xl p-6 animate-fade-in">
          <h2 className="text-base font-bold text-white mb-4">How agents earn money for you</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { step: '1', icon: '🔬', title: 'Research', desc: 'Agent scans DeFi protocols, exchanges and market data for opportunities' },
              { step: '2', icon: '💹', title: 'Identify', desc: 'Finds yield farming, arbitrage or content monetisation opportunity' },
              { step: '3', icon: '⚡', title: 'Execute', desc: 'Prepares transaction — you approve it in MetaMask before anything happens' },
              { step: '4', icon: '💰', title: 'Earn', desc: 'Profit flows directly to your connected wallet address' },
            ].map(s => (
              <div key={s.step} className="flex gap-3">
                <div className="w-8 h-8 rounded-xl bg-blue-600/20 border border-blue-500/25 flex items-center justify-center text-blue-400 font-bold text-sm flex-shrink-0">
                  {s.step}
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span>{s.icon}</span>
                    <p className="text-white text-sm font-semibold">{s.title}</p>
                  </div>
                  <p className="text-gray-400 text-xs leading-relaxed">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

      </main>

      <PageFooter />
      <BottomNav />
    </div>
  );
}