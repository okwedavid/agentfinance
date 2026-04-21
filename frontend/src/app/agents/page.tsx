"use client";
import { useEffect, useState } from "react";
import { isLoggedIn, createTask } from "@/lib/api";
import { TopNav, BottomNav, PageFooter } from "@/components/layout/Nav";
import Link from "next/link";

const AGENTS = [
  {
    id: 'research',
    name: 'Research Agent',
    icon: '🔬',
    color: 'from-blue-600/20 to-blue-800/10 border-blue-600/20',
    status: 'online',
    description: 'Scans crypto markets, finds opportunities, analyses DeFi yields, researches trends.',
    capabilities: ['Market analysis', 'Opportunity scoring', 'Price tracking', 'Trend detection', 'Risk assessment'],
    tasks: ['Find best DeFi yield right now', 'Research trending coins this week', 'Analyse current market sentiment', 'Find passive income opportunities'],
    badge: 'Most Popular',
  },
  {
    id: 'trading',
    name: 'Trading Agent',
    icon: '📈',
    color: 'from-emerald-600/20 to-emerald-800/10 border-emerald-600/20',
    status: 'online',
    description: 'Finds arbitrage between exchanges, identifies yield farming, sizes positions, manages risk.',
    capabilities: ['Arbitrage detection', 'Yield farming', 'Position sizing', 'Risk management', 'Exchange comparison'],
    tasks: ['Check ETH arbitrage across exchanges', 'Find highest APY stablecoin yield', 'Analyse BTC trading opportunity', 'Compare Uniswap vs Binance spreads'],
    badge: 'High Yield',
  },
  {
    id: 'content',
    name: 'Content Agent',
    icon: '✍️',
    color: 'from-violet-600/20 to-violet-800/10 border-violet-600/20',
    status: 'online',
    description: 'Writes monetisable crypto content — articles, newsletters, threads — ready to publish.',
    capabilities: ['Article writing', 'Newsletter creation', 'Twitter threads', 'Research reports', 'NFT descriptions'],
    tasks: ['Write a crypto newsletter', 'Create a Twitter thread about DeFi', 'Write a market analysis report', 'Draft an NFT collection description'],
    badge: 'Passive Income',
  },
  {
    id: 'execution',
    name: 'Execution Agent',
    icon: '⚡',
    color: 'from-amber-600/20 to-amber-800/10 border-amber-600/20',
    status: 'online',
    description: 'Prepares and routes on-chain transactions. Always requires your approval before executing.',
    capabilities: ['Balance checking', 'Transaction preparation', 'Profit sweeping', 'Multi-chain support', 'Gas estimation'],
    tasks: ['Check my wallet balance', 'Prepare ETH transfer to wallet', 'Route earnings to my address', 'Check gas fees right now'],
    badge: 'On-Chain',
  },
  {
    id: 'social',
    name: 'Social Agent',
    icon: '📱',
    color: 'from-pink-600/20 to-pink-800/10 border-pink-600/20',
    status: 'coming-soon',
    description: 'Posts content to TikTok, YouTube, Facebook, X. Grows your audience to monetise.',
    capabilities: ['TikTok posting', 'YouTube uploads', 'Facebook pages', 'X/Twitter automation', 'Audience growth'],
    tasks: [],
    badge: 'Coming Soon',
  },
  {
    id: 'security',
    name: 'Security Agent',
    icon: '🛡️',
    color: 'from-red-600/20 to-red-800/10 border-red-600/20',
    status: 'coming-soon',
    description: 'Monitors for suspicious activity, rug pulls, phishing, and keeps your assets safe.',
    capabilities: ['Rug pull detection', 'Phishing alerts', 'Wallet monitoring', 'Smart contract auditing', 'Threat alerts'],
    tasks: [],
    badge: 'Coming Soon',
  },
  {
    id: 'miner',
    name: 'Mining Agent',
    icon: '⛏️',
    color: 'from-orange-600/20 to-orange-800/10 border-orange-600/20',
    status: 'coming-soon',
    description: 'Monitors mining operations, optimises hashrate, tracks profitability across pools.',
    capabilities: ['Pool monitoring', 'Hashrate tracking', 'Profitability calc', 'Pool switching', 'Hardware alerts'],
    tasks: [],
    badge: 'Coming Soon',
  },
  {
    id: 'collab',
    name: 'Collaboration Agent',
    icon: '🤝',
    color: 'from-cyan-600/20 to-cyan-800/10 border-cyan-600/20',
    status: 'coming-soon',
    description: 'Connects with other users\' agents to find joint income opportunities and split profits.',
    capabilities: ['Agent networking', 'Profit sharing', 'Joint strategies', 'P2P arbitrage', 'Shared liquidity'],
    tasks: [],
    badge: 'Coming Soon',
  },
];

export default function AgentsPage() {
  const [launching, setLaunching] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoggedIn()) { window.location.href = '/login'; return; }
  }, []);

  async function launchTask(task: string) {
    setLaunching(task);
    try {
      await createTask(task);
      setSuccess(task);
      setTimeout(() => setSuccess(null), 3000);
      window.dispatchEvent(new CustomEvent('task:created'));
    } catch (e) {
      alert('Failed to create task. Make sure you are logged in.');
    } finally {
      setLaunching(null);
    }
  }

  return (
    <div className="min-h-screen bg-[#060b16] text-white flex flex-col">
      <TopNav />

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-8 pb-24 md:pb-8">

        <div className="mb-8 animate-fade-in">
          <h1 className="text-2xl font-bold text-white mb-2">AI Agent Fleet</h1>
          <p className="text-gray-400 text-sm">Deploy specialist agents that work 24/7 to generate income for you</p>
        </div>

        {success && (
          <div className="mb-4 bg-emerald-900/20 border border-emerald-700/30 rounded-xl px-4 py-3 text-emerald-400 text-sm animate-fade-in">
            ✅ Agent deployed: {success.slice(0, 60)}… — <Link href="/dashboard" className="underline">View in Dashboard →</Link>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {AGENTS.map((agent, i) => (
            <div
              key={agent.id}
              className={`rounded-2xl border bg-gradient-to-br p-5 flex flex-col gap-3 ${agent.color} animate-fade-in`}
              style={{ animationDelay: `${i * 60}ms` }}
            >
              {/* Header */}
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{agent.icon}</span>
                  <div>
                    <h3 className="text-white font-semibold text-sm">{agent.name}</h3>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <div className={`w-1.5 h-1.5 rounded-full ${agent.status === 'online' ? 'bg-emerald-400 animate-pulse' : 'bg-gray-500'}`} />
                      <span className="text-xs text-gray-500">{agent.status === 'online' ? 'Online' : 'Coming soon'}</span>
                    </div>
                  </div>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  agent.badge === 'Coming Soon' ? 'bg-gray-700 text-gray-400' :
                  agent.badge === 'Most Popular' ? 'bg-blue-600/30 text-blue-300' :
                  agent.badge === 'High Yield' ? 'bg-emerald-600/30 text-emerald-300' :
                  agent.badge === 'Passive Income' ? 'bg-violet-600/30 text-violet-300' :
                  agent.badge === 'On-Chain' ? 'bg-amber-600/30 text-amber-300' :
                  'bg-gray-700 text-gray-400'
                }`}>{agent.badge}</span>
              </div>

              {/* Description */}
              <p className="text-gray-400 text-xs leading-relaxed">{agent.description}</p>

              {/* Capabilities */}
              <div className="flex flex-wrap gap-1">
                {agent.capabilities.slice(0, 4).map(c => (
                  <span key={c} className="text-xs bg-white/5 border border-white/8 rounded-md px-2 py-0.5 text-gray-400">{c}</span>
                ))}
              </div>

              {/* Quick launch tasks */}
              {agent.status === 'online' && agent.tasks.length > 0 && (
                <div className="space-y-1.5 border-t border-white/[0.05] pt-3">
                  <p className="text-gray-600 text-xs mb-2">Quick launch:</p>
                  {agent.tasks.map(task => (
                    <button
                      key={task}
                      onClick={() => launchTask(task)}
                      disabled={launching === task}
                      className="w-full text-left text-xs text-gray-300 hover:text-white bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.06] rounded-lg px-3 py-2 transition-all disabled:opacity-50 flex items-center justify-between gap-2"
                    >
                      <span className="truncate">{task}</span>
                      {launching === task ? (
                        <div className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin flex-shrink-0" />
                      ) : (
                        <span className="text-gray-600 flex-shrink-0">▶</span>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {agent.status === 'coming-soon' && (
                <div className="border-t border-white/[0.05] pt-3">
                  <p className="text-gray-600 text-xs text-center">Notify me when available</p>
                  <button className="w-full mt-2 text-xs bg-white/5 border border-white/8 rounded-lg px-3 py-2 text-gray-400 hover:text-white hover:bg-white/10 transition-all">
                    Get notified
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

      </main>

      <PageFooter />
      <BottomNav />
    </div>
  );
}