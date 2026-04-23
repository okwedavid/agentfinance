"use client";
import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { isLoggedIn, deleteAllTasks, API_BASE, getToken } from "@/lib/api";
import { useWebSocket } from "@/hooks/useWebSocket";
import { TopNav, BottomNav, PageFooter } from "@/components/layout/Nav";

// ── Toggle component ────────────────────────────────────────────────────────
function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!on)} role="switch" aria-checked={on}
      className={`relative flex-shrink-0 transition-all duration-200 rounded-full border ${
        on ? 'bg-blue-600 border-blue-500' : 'bg-white/[0.06] border-white/10'
      }`}
      style={{ width: 40, height: 22 }}>
      <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all duration-200 ${
        on ? 'left-5' : 'left-0.5'
      }`} />
    </button>
  );
}

// ── Agent config options ────────────────────────────────────────────────────
const AGENT_OPTS = [
  { key: 'autoRun',          label: 'Auto-run agents',        desc: 'Agents process tasks immediately when created', def: true },
  { key: 'notifications',    label: 'Browser notifications',  desc: 'Notify you when agents complete tasks', def: true },
  { key: 'collaboration',    label: 'Agent collaboration',     desc: 'Allow your agents to work with other users\' agents', def: false },
  { key: 'autoSweep',        label: 'Auto-sweep earnings',    desc: 'Automatically move earned ETH to your wallet', def: false },
  { key: 'conservative',     label: 'Conservative mode',      desc: 'Agents prefer lower-risk strategies', def: true },
  { key: 'contentPublish',   label: 'Auto-publish content',   desc: 'Content agent can post to connected platforms', def: false },
  { key: 'darkTheme',        label: 'Dark theme',             desc: 'Always use dark mode (currently only mode)', def: true },
  { key: 'emailAlerts',      label: 'Email alerts',           desc: 'Get emailed when high-value opportunities found', def: false },
];

// ── Free APIs (admin-only view) ─────────────────────────────────────────────
const FREE_APIS = [
  { cat: '🤖 AI / LLM', items: [
    { name:'Groq',         url:'console.groq.com',           key:'GROQ_API_KEY',          desc:'14,400 req/day free, llama-3.3-70b-versatile' },
    { name:'Google AI',    url:'aistudio.google.com',        key:'GOOGLE_AI_API_KEY',     desc:'1,500 req/day, Gemini 2.0 Flash, very generous' },
    { name:'OpenRouter',   url:'openrouter.ai',              key:'OPENROUTER_API_KEY',    desc:'Free models: llama, mistral, qwen, deepseek' },
    { name:'Together AI',  url:'api.together.xyz',           key:'TOGETHER_API_KEY',      desc:'$25 free credits, Llama 4 Scout + many models' },
    { name:'Cohere',       url:'cohere.com',                 key:'COHERE_API_KEY',        desc:'Free trial, Command R, good for tool use' },
    { name:'Mistral',      url:'console.mistral.ai',         key:'MISTRAL_API_KEY',       desc:'Free tier, Mistral 7B and 8x7B' },
    { name:'DeepInfra',    url:'deepinfra.com',              key:'DEEPINFRA_API_KEY',     desc:'$1.80 free credits, 100+ open models' },
    { name:'Cerebras',     url:'cloud.cerebras.ai',          key:'CEREBRAS_API_KEY',      desc:'1,800 tok/s inference speed, Llama 3.1 free' },
    { name:'Perplexity',   url:'perplexity.ai/api',          key:'PERPLEXITY_API_KEY',    desc:'$5 free credits, web-search grounded answers' },
    { name:'Fireworks AI', url:'fireworks.ai',               key:'FIREWORKS_API_KEY',     desc:'$1 free credits, fast Llama inference' },
  ]},
  { cat: '💰 Crypto Prices', items: [
    { name:'CoinGecko',    url:'coingecko.com/api',          key:'COINGECKO_API_KEY',     desc:'30 calls/min free, 10k+ coins, no auth needed for basic' },
    { name:'CoinMarketCap',url:'coinmarketcap.com/api',      key:'CMC_API_KEY',           desc:'333 calls/day free, 20k+ cryptos' },
    { name:'CryptoCompare',url:'cryptocompare.com',          key:'CRYPTOCOMPARE_API_KEY', desc:'100k calls/month free tier' },
    { name:'Binance',      url:'api.binance.com',            key:null,                    desc:'No key required for public market data' },
    { name:'Coinbase',     url:'coinbase.com/cloud',         key:'COINBASE_API_KEY',      desc:'Free public data and websocket feed' },
    { name:'Kraken',       url:'kraken.com/api',             key:null,                    desc:'No key needed for all market data' },
    { name:'CoinPaprika',  url:'api.coinpaprika.com',        key:null,                    desc:'No key, 25,000 calls/month free' },
    { name:'Mobula',       url:'mobula.io',                  key:'MOBULA_API_KEY',        desc:'Real-time DeFi data, 10k req/day free' },
    { name:'DexScreener',  url:'dexscreener.com/api',        key:null,                    desc:'No key, DEX pairs and trading data, 300 req/min' },
    { name:'GeckoTerminal',url:'geckoterminal.com',          key:null,                    desc:'No key required, on-chain DEX live data' },
    { name:'DeFiLlama',    url:'defillama.com/docs/api',     key:null,                    desc:'No key, TVL and protocol yield data' },
    { name:'Alternative.me',url:'alternative.me',            key:null,                    desc:'Fear & Greed index API, no key needed' },
    { name:'Messari',      url:'messari.io/api',             key:'MESSARI_API_KEY',       desc:'Crypto research data and metrics, free tier' },
  ]},
  { cat: '🔗 Blockchain / Wallet', items: [
    { name:'Alchemy',      url:'alchemy.com',                key:'ALCHEMY_API_KEY',       desc:'300M compute units/month free — HIGHLY RECOMMENDED' },
    { name:'Infura',       url:'infura.io',                  key:'INFURA_API_KEY',        desc:'100k requests/day free, Ethereum + IPFS' },
    { name:'QuickNode',    url:'quicknode.com',              key:'QUICKNODE_API_KEY',     desc:'10M credits/month free, 25+ chains' },
    { name:'Ankr',         url:'ankr.com',                   key:'ANKR_API_KEY',          desc:'30 req/sec free, 40+ blockchains supported' },
    { name:'Chainstack',   url:'chainstack.com',             key:'CHAINSTACK_API_KEY',    desc:'3M requests/month free tier' },
    { name:'Moralis',      url:'moralis.io',                 key:'MORALIS_API_KEY',       desc:'40,000 requests/day, NFT + DeFi data' },
    { name:'Covalent',     url:'goldrush.dev',               key:'COVALENT_API_KEY',      desc:'100k calls/month, unified multi-chain API' },
    { name:'Etherscan',    url:'etherscan.io/api',           key:'ETHERSCAN_API_KEY',     desc:'5 calls/sec, full transaction history' },
    { name:'Polygonscan',  url:'polygonscan.com/api',        key:'POLYGONSCAN_API_KEY',   desc:'Same as Etherscan but for Polygon network' },
    { name:'BaseScan',     url:'basescan.org/api',           key:'BASESCAN_API_KEY',      desc:'Base chain explorer, free API key' },
    { name:'Arbiscan',     url:'arbiscan.io/api',            key:'ARBISCAN_API_KEY',      desc:'Arbitrum explorer API, free' },
    { name:'BscScan',      url:'bscscan.com/api',            key:'BSCSCAN_API_KEY',       desc:'BSC explorer, free API key' },
    { name:'Solscan',      url:'solscan.io/api',             key:'SOLSCAN_API_KEY',       desc:'Solana explorer data, free tier' },
    { name:'Helius',       url:'helius.dev',                 key:'HELIUS_API_KEY',        desc:'Solana RPC + DAS API, 100k credits/day free' },
  ]},
  { cat: '🌐 Web Search', items: [
    { name:'Tavily',       url:'tavily.com',                 key:'TAVILY_API_KEY',        desc:'1,000 searches/month free — best for agents' },
    { name:'Serper',       url:'serper.dev',                 key:'SERPER_API_KEY',        desc:'2,500 free searches, Google results' },
    { name:'Brave Search', url:'brave.com/search/api',       key:'BRAVE_SEARCH_API_KEY',  desc:'2,000 queries/month free tier' },
    { name:'SerpAPI',      url:'serpapi.com',                key:'SERPAPI_KEY',           desc:'100 searches/month free' },
    { name:'Exa',          url:'exa.ai',                     key:'EXA_API_KEY',           desc:'1,000 searches/month, semantic search' },
    { name:'Bing Search',  url:'azure.microsoft.com',        key:'BING_API_KEY',          desc:'3,000 calls/month free on Azure' },
  ]},
  { cat: '📰 News & Sentiment', items: [
    { name:'CryptoPanic',  url:'cryptopanic.com/api',        key:'CRYPTOPANIC_API_KEY',   desc:'Crypto news aggregator, free plan' },
    { name:'NewsAPI',      url:'newsapi.org',                key:'NEWSAPI_KEY',           desc:'100 requests/day free, all global news' },
    { name:'LunarCrush',   url:'lunarcrush.com',             key:'LUNARCRUSH_API_KEY',    desc:'Social media signals and sentiment, free tier' },
    { name:'Santiment',    url:'santiment.net/api',          key:'SANTIMENT_API_KEY',     desc:'On-chain + social sentiment data' },
    { name:'NewsData.io',  url:'newsdata.io',                key:'NEWSDATA_API_KEY',      desc:'200 calls/day free, crypto + general news' },
  ]},
  { cat: '⚡ DeFi Specific', items: [
    { name:'The Graph',    url:'thegraph.com',               key:'THEGRAPH_API_KEY',      desc:'100k queries/month free, any protocol subgraph' },
    { name:'1inch',        url:'1inch.dev',                  key:'ONEINCH_API_KEY',       desc:'DEX aggregator, best swap routes, free' },
    { name:'Uniswap',      url:'docs.uniswap.org',           key:null,                    desc:'No key needed, public subgraph' },
    { name:'Aave',         url:'docs.aave.com',              key:null,                    desc:'No key, lending rates API' },
    { name:'Compound',     url:'compound.finance/developers',key:null,                    desc:'No key, interest rate data' },
    { name:'Lido',         url:'docs.lido.fi',               key:null,                    desc:'ETH staking APY, free' },
    { name:'Yearn',        url:'yearn.finance',              key:null,                    desc:'Vault yields and strategies, no key' },
    { name:'Curve',        url:'curve.fi/api',               key:null,                    desc:'Pool APY and liquidity data, free' },
    { name:'Convex',       url:'docs.convexfinance.com',     key:null,                    desc:'Boosted Curve yields, no key' },
    { name:'Pendle',       url:'api-v2.pendle.finance',      key:null,                    desc:'Yield trading data, no key required' },
  ]},
  { cat: '🐦 Social / Content', items: [
    { name:'Twitter/X API',url:'developer.twitter.com',     key:'TWITTER_API_KEY',       desc:'Free tier: 1,500 tweets/month read access' },
    { name:'Reddit API',   url:'reddit.com/dev/api',        key:'REDDIT_API_KEY',        desc:'60 req/min free, read posts and comments' },
    { name:'YouTube Data', url:'console.developers.google.com',key:'YOUTUBE_API_KEY',    desc:'10,000 units/day free' },
    { name:'TikTok API',   url:'developers.tiktok.com',     key:'TIKTOK_API_KEY',        desc:'Content posting via Login Kit, free' },
    { name:'Telegram Bot', url:'t.me/BotFather',            key:'TELEGRAM_BOT_TOKEN',    desc:'Free bot API, send messages to users' },
    { name:'Discord Bot',  url:'discord.com/developers',    key:'DISCORD_BOT_TOKEN',     desc:'Free bot API, post to channels' },
  ]},
];

export default function SettingsPage() {
  const { user, isAdmin } = useAuth();
  const [settings, setSettings] = useState<Record<string, boolean>>({});
  const [savedDot, setSavedDot] = useState(false);
  const [tab, setTab] = useState<'agents' | 'apis' | 'danger'>('agents');
  const [clearing, setClearing] = useState(false);
  const [clearMsg, setClearMsg] = useState('');
  const { connectionStatus: wsStatus } = useWebSocket();

  useEffect(() => {
    if (!isLoggedIn()) { window.location.href = '/login'; return; }
    const raw = localStorage.getItem('af_settings');
    if (raw) { try { setSettings(JSON.parse(raw)); } catch {} }
    else {
      const d: Record<string, boolean> = {};
      AGENT_OPTS.forEach(o => { d[o.key] = o.def; });
      setSettings(d);
    }
  }, []);

  function toggle(key: string, val: boolean) {
    const next = { ...settings, [key]: val };
    setSettings(next);
    localStorage.setItem('af_settings', JSON.stringify(next));
    setSavedDot(true);
    setTimeout(() => setSavedDot(false), 2000);
  }

  async function clearHistory() {
    if (!confirm('Delete ALL task history? This cannot be undone.')) return;
    setClearing(true);
    try {
      // Try bulk endpoint first
      const r = await fetch(`${API_BASE}/tasks/all`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      if (r.ok) { setClearMsg('✅ All history cleared'); }
      else {
        // Fallback: get tasks and delete individually
        const tr = await fetch(`${API_BASE}/tasks`, { headers: { Authorization: `Bearer ${getToken()}` } });
        const tasks = await tr.json();
        if (Array.isArray(tasks)) {
          await Promise.all(tasks.map(t =>
            fetch(`${API_BASE}/tasks/${t.id}`, {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${getToken()}` }
            }).catch(() => {})
          ));
          setClearMsg(`✅ Cleared ${tasks.length} tasks`);
        }
      }
    } catch (e: any) { setClearMsg(`❌ ${e.message}`); }
    finally { setClearing(false); setTimeout(() => setClearMsg(''), 5000); }
  }

  function disconnectWallet() {
    if (!confirm('Disconnect wallet?')) return;
    localStorage.removeItem('agentfi_wallet');
    fetch(`${API_BASE}/auth/wallet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify({ walletAddress: null }),
    }).catch(() => {});
    setClearMsg('✅ Wallet disconnected');
    setTimeout(() => setClearMsg(''), 4000);
  }

  const TABS: { id: 'agents' | 'apis' | 'danger'; label: string; adminOnly?: true }[] = [
    { id: 'agents', label: '🤖 Agents' },
    { id: 'apis',   label: '🔌 APIs',   adminOnly: true },
    { id: 'danger', label: '⚠️ Danger' },
  ];

  return (
    <div className="min-h-screen bg-[#050c18] flex flex-col">
      <TopNav wsStatus={wsStatus} />

      <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-6 pb-24 md:pb-6 space-y-4 page-enter">

        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">Settings</h1>
            <p className="text-gray-400 text-sm">Configure your agent fleet and preferences</p>
          </div>
          {savedDot && (
            <div className="flex items-center gap-2 text-emerald-400 text-sm animate-fade-in">
              <div className="w-2 h-2 bg-emerald-400 rounded-full" /> Saved
            </div>
          )}
        </div>

        {clearMsg && (
          <div className={`px-4 py-3 rounded-xl border text-sm animate-fade-in ${
            clearMsg.startsWith('✅') ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400'
            : 'bg-red-500/10 border-red-500/25 text-red-400'
          }`}>{clearMsg}</div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 bg-white/[0.03] border border-white/[0.06] rounded-xl p-1">
          {TABS.filter(t => !t.adminOnly || isAdmin).map(t => (
            <button key={t.id} onClick={() => setTab(t.id as any)}
              className={`flex-1 text-xs py-2 rounded-lg transition-all font-medium ${
                tab === t.id ? 'bg-blue-600 text-white shadow' : 'text-gray-400 hover:text-white'
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Agent settings ── */}
        {tab === 'agents' && (
          <div className="glass rounded-2xl overflow-hidden animate-fade-in">
            <div className="px-5 py-4 border-b border-white/[0.06]">
              <h2 className="text-sm font-semibold text-white">Agent Behaviour</h2>
              <p className="text-gray-500 text-xs mt-0.5">Control how your AI agents operate</p>
            </div>
            <div className="divide-y divide-white/[0.04]">
              {AGENT_OPTS.map(opt => (
                <div key={opt.key} className="flex items-center gap-4 px-5 py-4 hover:bg-white/[0.01] transition-colors">
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium">{opt.label}</p>
                    <p className="text-gray-500 text-xs mt-0.5">{opt.desc}</p>
                  </div>
                  <Toggle
                    on={settings[opt.key] ?? opt.def}
                    onChange={v => toggle(opt.key, v)}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── APIs (admin only) ── */}
        {tab === 'apis' && isAdmin && (
          <div className="space-y-4 animate-fade-in">
            <div className="glass rounded-2xl p-4 border border-blue-600/20">
              <p className="text-blue-300 text-sm leading-relaxed">
                <strong className="text-white">Admin view.</strong> Add these to your{' '}
                <strong className="text-white">Railway backend</strong> environment variables.
                The more keys you add, the more capable and reliable your agents become.
                All listed tiers are free. Regular users cannot see this section.
              </p>
            </div>

            {FREE_APIS.map(cat => (
              <div key={cat.cat} className="glass rounded-2xl overflow-hidden">
                <div className="px-5 py-3 border-b border-white/[0.06] bg-white/[0.02]">
                  <h3 className="text-sm font-semibold text-white">{cat.cat}</h3>
                  <p className="text-gray-600 text-xs">{cat.items.length} APIs</p>
                </div>
                <div className="divide-y divide-white/[0.03]">
                  {cat.items.map(api => (
                    <div key={api.name}
                      className="flex items-center gap-4 px-5 py-3 hover:bg-white/[0.02] transition-colors">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-white text-sm font-medium">{api.name}</span>
                          <a href={`https://${api.url}`} target="_blank" rel="noopener noreferrer"
                            className="text-blue-400 text-xs hover:text-blue-300">↗</a>
                        </div>
                        <p className="text-gray-500 text-xs mt-0.5">{api.desc}</p>
                      </div>
                      {api.key ? (
                        <code className="text-emerald-400 text-[10px] bg-black/40 px-2 py-1 rounded font-mono flex-shrink-0 border border-white/[0.06]">
                          {api.key}
                        </code>
                      ) : (
                        <span className="text-gray-600 text-xs flex-shrink-0 italic">No key needed</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Danger zone ── */}
        {tab === 'danger' && (
          <div className="space-y-4 animate-fade-in">
            <div className="glass rounded-2xl p-5 border border-red-800/30">
              <h3 className="text-red-400 font-semibold text-sm mb-1">Clear Task History</h3>
              <p className="text-gray-500 text-xs mb-4">
                Permanently delete all your tasks, agent runs, and analytics. Cannot be undone.
              </p>
              <button onClick={clearHistory} disabled={clearing}
                className="bg-red-900/30 border border-red-700/40 text-red-400 text-sm px-4 py-2 rounded-xl hover:bg-red-900/50 transition-colors disabled:opacity-40">
                {clearing ? '⏳ Clearing…' : '🗑 Delete All History'}
              </button>
            </div>

            <div className="glass rounded-2xl p-5 border border-red-800/30">
              <h3 className="text-red-400 font-semibold text-sm mb-1">Disconnect Wallet</h3>
              <p className="text-gray-500 text-xs mb-4">
                Remove your connected wallet. Agents will stop routing earnings until you reconnect.
              </p>
              <button onClick={disconnectWallet}
                className="bg-red-900/30 border border-red-700/40 text-red-400 text-sm px-4 py-2 rounded-xl hover:bg-red-900/50 transition-colors">
                Disconnect Wallet
              </button>
            </div>

            <div className="glass rounded-2xl p-5 border border-orange-800/20">
              <h3 className="text-orange-400 font-semibold text-sm mb-1">⚠️ Critical: Fix API URL</h3>
              <p className="text-gray-400 text-xs mb-3 leading-relaxed">
                Your Railway frontend still has <code className="text-orange-300 bg-black/30 px-1 rounded">NEXT_PUBLIC_API_URL=http://localhost:4000</code>.
                This breaks ALL agent calls. Change it to:
              </p>
              <code className="block text-emerald-300 text-xs bg-black/40 border border-white/[0.06] rounded-xl p-3 font-mono">
                NEXT_PUBLIC_API_URL=https://serene-magic-production-6d0c.up.railway.app{'\n'}
                NEXT_PUBLIC_WS_URL=wss://serene-magic-production-6d0c.up.railway.app
              </code>
              <p className="text-gray-600 text-xs mt-2">In Railway → Frontend service → Variables → redeploy</p>
            </div>
          </div>
        )}

      </main>

      <PageFooter />
      <BottomNav />
    </div>
  );
}