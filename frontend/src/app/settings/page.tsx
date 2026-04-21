"use client";
import { useEffect, useState } from "react";
import { isLoggedIn, apiFetch } from "@/lib/api";
import { TopNav, BottomNav, PageFooter } from "@/components/layout/Nav";

interface Setting {
  key: string;
  label: string;
  description: string;
  defaultValue: boolean;
}

const AGENT_SETTINGS: Setting[] = [
  { key: 'autoRun', label: 'Auto-run agents', description: 'Agents start processing tasks immediately when created', defaultValue: true },
  { key: 'notifications', label: 'Task notifications', description: 'Browser notifications when agents complete tasks', defaultValue: true },
  { key: 'agentCollaboration', label: 'Agent collaboration', description: 'Allow your agents to communicate with other users\' agents to find opportunities', defaultValue: false },
  { key: 'autoSweep', label: 'Auto-sweep earnings', description: 'Automatically sweep earned funds to your connected wallet', defaultValue: false },
  { key: 'riskMode', label: 'Conservative mode', description: 'Agents prefer lower-risk, lower-return strategies', defaultValue: true },
  { key: 'contentPublish', label: 'Auto-publish content', description: 'Content agent can publish directly to connected platforms', defaultValue: false },
];

const FREE_APIS = [
  { category: '🤖 AI / LLM', items: [
    { name: 'Groq', url: 'console.groq.com', key: 'GROQ_API_KEY', desc: '14,400 req/day, llama-3.3-70b, free forever' },
    { name: 'Google AI Studio', url: 'aistudio.google.com', key: 'GOOGLE_AI_API_KEY', desc: '1,500 req/day, Gemini 2.0 Flash, very generous' },
    { name: 'OpenRouter', url: 'openrouter.ai', key: 'OPENROUTER_API_KEY', desc: 'Free models: llama, mistral, qwen' },
    { name: 'Together AI', url: 'api.together.xyz', key: 'TOGETHER_API_KEY', desc: '$25 free credits, Llama 4 Scout' },
    { name: 'Cohere', url: 'cohere.com', key: 'COHERE_API_KEY', desc: 'Free tier, Command models, good tool calling' },
    { name: 'Mistral AI', url: 'console.mistral.ai', key: 'MISTRAL_API_KEY', desc: 'Free tier, Mistral 7B/8x7B' },
    { name: 'DeepInfra', url: 'deepinfra.com', key: 'DEEPINFRA_API_KEY', desc: '$1.80 free credits, 100+ models' },
    { name: 'Cerebras', url: 'cloud.cerebras.ai', key: 'CEREBRAS_API_KEY', desc: '1,800 tok/s, Llama 3.1 8B/70B, free tier' },
  ]},
  { category: '💰 Crypto Prices', items: [
    { name: 'CoinGecko', url: 'coingecko.com/api', key: 'COINGECKO_API_KEY', desc: '30 calls/min free, 10k+ coins' },
    { name: 'CoinMarketCap', url: 'coinmarketcap.com/api', key: 'CMC_API_KEY', desc: 'Free tier 333 calls/day, 20k+ coins' },
    { name: 'CryptoCompare', url: 'cryptocompare.com', key: 'CRYPTOCOMPARE_API_KEY', desc: '100k calls/month free' },
    { name: 'Binance', url: 'binance.com/api', key: null, desc: 'No key needed for public endpoints' },
    { name: 'Coinbase Advanced', url: 'coinbase.com', key: 'COINBASE_API_KEY', desc: 'Free public data, websocket feed' },
    { name: 'Kraken', url: 'kraken.com/api', key: null, desc: 'No key needed for market data' },
    { name: 'CoinPaprika', url: 'api.coinpaprika.com', key: null, desc: 'No key, 25,000 calls/month free' },
    { name: 'Mobula', url: 'mobula.io', key: 'MOBULA_API_KEY', desc: 'Real-time DeFi data, free tier' },
    { name: 'DexScreener', url: 'dexscreener.com/api', key: null, desc: 'No key, DEX pairs, 300 req/min' },
    { name: 'GeckoTerminal', url: 'geckoterminal.com', key: null, desc: 'No key, on-chain DEX data' },
    { name: 'DeFiLlama', url: 'defillama.com/api', key: null, desc: 'No key, TVL and yield data' },
    { name: 'Alternative.me', url: 'alternative.me', key: null, desc: 'Fear & Greed index, free' },
  ]},
  { category: '🔗 Blockchain / Wallet', items: [
    { name: 'Alchemy', url: 'alchemy.com', key: 'ALCHEMY_API_KEY', desc: '300M compute units/month free' },
    { name: 'Infura', url: 'infura.io', key: 'INFURA_API_KEY', desc: '100k req/day free on Ethereum/IPFS' },
    { name: 'QuickNode', url: 'quicknode.com', key: 'QUICKNODE_API_KEY', desc: 'Free tier, 10M credits/month' },
    { name: 'Ankr', url: 'ankr.com', key: 'ANKR_API_KEY', desc: '30 req/sec free, 40+ blockchains' },
    { name: 'Chainstack', url: 'chainstack.com', key: 'CHAINSTACK_API_KEY', desc: '3M requests/month free' },
    { name: 'Moralis', url: 'moralis.io', key: 'MORALIS_API_KEY', desc: '40,000 req/day, NFT+DeFi data' },
    { name: 'Covalent', url: 'goldrush.dev', key: 'COVALENT_API_KEY', desc: '100k calls/month, token balances' },
    { name: 'Etherscan', url: 'etherscan.io/api', key: 'ETHERSCAN_API_KEY', desc: '5 calls/sec, transaction history' },
    { name: 'Polygonscan', url: 'polygonscan.com/api', key: 'POLYGONSCAN_API_KEY', desc: 'Same as Etherscan for Polygon' },
    { name: 'BaseScan', url: 'basescan.org/api', key: 'BASESCAN_API_KEY', desc: 'Base chain explorer API' },
  ]},
  { category: '🌐 Web Search', items: [
    { name: 'Tavily', url: 'tavily.com', key: 'TAVILY_API_KEY', desc: '1,000 searches/month free' },
    { name: 'Serper', url: 'serper.dev', key: 'SERPER_API_KEY', desc: '2,500 free searches' },
    { name: 'Brave Search', url: 'brave.com/search/api', key: 'BRAVE_SEARCH_API_KEY', desc: '2,000 queries/month free' },
    { name: 'SerpAPI', url: 'serpapi.com', key: 'SERPAPI_KEY', desc: '100 searches/month free' },
    { name: 'Exa', url: 'exa.ai', key: 'EXA_API_KEY', desc: '1,000 searches/month free' },
  ]},
  { category: '📰 News & Sentiment', items: [
    { name: 'CryptoPanic', url: 'cryptopanic.com/api', key: 'CRYPTOPANIC_API_KEY', desc: 'Crypto news aggregator, free tier' },
    { name: 'NewsAPI', url: 'newsapi.org', key: 'NEWSAPI_KEY', desc: '100 req/day free, all news' },
    { name: 'Messari', url: 'messari.io/api', key: 'MESSARI_API_KEY', desc: 'Crypto research data, free tier' },
    { name: 'LunarCrush', url: 'lunarcrush.com', key: 'LUNARCRUSH_API_KEY', desc: 'Social signals, free tier' },
  ]},
  { category: '⚡ DeFi Specific', items: [
    { name: 'The Graph', url: 'thegraph.com', key: 'THEGRAPH_API_KEY', desc: '100k queries/month free, subgraphs' },
    { name: '1inch', url: '1inch.dev', key: 'ONEINCH_API_KEY', desc: 'DEX aggregator, swap routes' },
    { name: 'Uniswap', url: 'docs.uniswap.org', key: null, desc: 'No key needed, public subgraph' },
    { name: 'Aave', url: 'docs.aave.com', key: null, desc: 'No key, lending/borrowing rates' },
    { name: 'Compound', url: 'compound.finance/developers', key: null, desc: 'No key, interest rates' },
    { name: 'Lido', url: 'docs.lido.fi', key: null, desc: 'ETH staking APY, no key' },
    { name: 'Yearn', url: 'yearn.finance/v3', key: null, desc: 'Vault strategies, no key' },
  ]},
];

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={`relative w-10 h-5.5 rounded-full transition-all flex-shrink-0 ${value ? 'bg-blue-600' : 'bg-white/10'}`}
      style={{ minWidth: 40, height: 22 }}
    >
      <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${value ? 'left-5' : 'left-0.5'}`} />
    </button>
  );
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState(false);
  const [activeTab, setActiveTab] = useState<'agents'|'apis'|'danger'>('agents');

  useEffect(() => {
    if (!isLoggedIn()) { window.location.href = '/login'; return; }
    const stored = localStorage.getItem('af_settings');
    if (stored) {
      try { setSettings(JSON.parse(stored)); } catch {}
    } else {
      const defaults: Record<string, boolean> = {};
      AGENT_SETTINGS.forEach(s => { defaults[s.key] = s.defaultValue; });
      setSettings(defaults);
    }
  }, []);

  function toggle(key: string, value: boolean) {
    const next = { ...settings, [key]: value };
    setSettings(next);
    localStorage.setItem('af_settings', JSON.stringify(next));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const TABS = [
    { id: 'agents', label: '🤖 Agent Config' },
    { id: 'apis',   label: '🔌 Free APIs' },
    { id: 'danger', label: '⚠️ Danger Zone' },
  ] as const;

  return (
    <div className="min-h-screen bg-[#060b16] text-white flex flex-col">
      <TopNav />

      <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-8 pb-24 md:pb-8">

        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-xl font-bold text-white">Settings</h1>
          {saved && <span className="text-emerald-400 text-sm animate-fade-in">✓ Saved</span>}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-5 bg-white/[0.03] p-1 rounded-xl border border-white/[0.05]">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`flex-1 text-xs py-2 rounded-lg transition-all ${
                activeTab === t.id ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {activeTab === 'agents' && (
          <div className="glass rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-white/[0.05]">
              <h2 className="text-sm font-semibold text-white">Agent Behaviour</h2>
              <p className="text-gray-500 text-xs mt-0.5">Control how your AI agents operate</p>
            </div>
            <div className="divide-y divide-white/[0.04]">
              {AGENT_SETTINGS.map(s => (
                <div key={s.key} className="flex items-center gap-4 px-5 py-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium">{s.label}</p>
                    <p className="text-gray-500 text-xs mt-0.5">{s.description}</p>
                  </div>
                  <Toggle
                    value={settings[s.key] ?? s.defaultValue}
                    onChange={v => toggle(s.key, v)}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'apis' && (
          <div className="space-y-4">
            <div className="glass rounded-2xl p-4">
              <p className="text-gray-300 text-sm">
                Add these API keys to your <strong className="text-white">Railway backend</strong> environment variables. 
                The more keys you add, the more capable and reliable your agents become. 
                <span className="text-emerald-400"> All free tiers listed.</span>
              </p>
            </div>

            {FREE_APIS.map(cat => (
              <div key={cat.category} className="glass rounded-2xl overflow-hidden">
                <div className="px-5 py-3 border-b border-white/[0.05] bg-white/[0.02]">
                  <h3 className="text-sm font-semibold text-white">{cat.category}</h3>
                </div>
                <div className="divide-y divide-white/[0.03]">
                  {cat.items.map(api => (
                    <div key={api.name} className="flex items-center gap-4 px-5 py-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-white text-sm font-medium">{api.name}</span>
                          <a href={`https://${api.url}`} target="_blank" rel="noopener noreferrer"
                            className="text-blue-400 text-xs hover:text-blue-300 transition-colors">↗</a>
                        </div>
                        <p className="text-gray-500 text-xs">{api.desc}</p>
                      </div>
                      {api.key ? (
                        <code className="text-emerald-400 text-xs bg-black/30 px-2 py-1 rounded font-mono flex-shrink-0">
                          {api.key}
                        </code>
                      ) : (
                        <span className="text-gray-600 text-xs flex-shrink-0">No key needed</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'danger' && (
          <div className="space-y-4">
            <div className="glass rounded-2xl p-5 border border-red-900/30">
              <h3 className="text-red-400 font-semibold text-sm mb-1">Clear All Task History</h3>
              <p className="text-gray-500 text-xs mb-4">Permanently delete all your tasks and analytics. This cannot be undone.</p>
              <button className="bg-red-900/30 border border-red-700/40 text-red-400 text-sm px-4 py-2 rounded-xl hover:bg-red-900/50 transition-colors">
                Clear History
              </button>
            </div>

            <div className="glass rounded-2xl p-5 border border-red-900/30">
              <h3 className="text-red-400 font-semibold text-sm mb-1">Disconnect Wallet</h3>
              <p className="text-gray-500 text-xs mb-4">Remove your connected wallet. Agents will stop routing earnings.</p>
              <button
                onClick={() => {
                  localStorage.removeItem('agentfi_wallet');
                  alert('Wallet disconnected. Go to Wallet page to reconnect.');
                }}
                className="bg-red-900/30 border border-red-700/40 text-red-400 text-sm px-4 py-2 rounded-xl hover:bg-red-900/50 transition-colors">
                Disconnect Wallet
              </button>
            </div>

            <div className="glass rounded-2xl p-5 border border-red-900/30">
              <h3 className="text-red-400 font-semibold text-sm mb-1">Delete Account</h3>
              <p className="text-gray-500 text-xs mb-4">Permanently delete your account and all associated data.</p>
              <button className="bg-red-900/30 border border-red-700/40 text-red-400 text-sm px-4 py-2 rounded-xl hover:bg-red-900/50 transition-colors opacity-50 cursor-not-allowed">
                Delete Account (contact support)
              </button>
            </div>
          </div>
        )}

      </main>

      <PageFooter />
      <BottomNav />
    </div>
  );
}