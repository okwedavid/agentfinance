'use client';

import { useState, useEffect } from 'react';
import { API_URL } from '@/lib/env';

type Product = {
  id: string;
  slug: string;
  brandName: string;
  title: string;
  price: number;
  status: string;
  evaluation?: any;
  createdAt: string;
  outcome?: string;
};

export default function FactoryPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [generating, setGenerating] = useState(false);
  const [batch, setBatch] = useState(1);
  const [niche, setNiche] = useState('');
  const [lastResult, setLastResult] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'products' | 'generate' | 'ecommerce'>('products');

  const API = API_URL;

  const fetchProducts = async () => {
    try {
      const res = await fetch(`${API}/api/factory/products?take=50`);
      const data = await res.json();
      if (Array.isArray(data)) setProducts(data);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => { fetchProducts(); }, []);

  const generate = async () => {
    setGenerating(true);
    try {
      const res = await fetch(`${API}/api/factory/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ niche: niche || null, batch })
      });
      const data = await res.json();
      setLastResult(data);
      fetchProducts();
    } catch (e: any) {
      setLastResult({ error: e.message });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-4xl font-black mb-2">🚀 Digital Factory v2.0</h1>
        <p className="text-slate-400 mb-6">AI Product Factory → Ecommerce (Groq Free) • Outcome-driven products, not toolkits</p>

        <div className="flex gap-2 mb-8">
          {(['products','generate','ecommerce'] as const).map(tab=>(
            <button key={tab} onClick={()=>setActiveTab(tab)} className={`px-5 py-2 rounded-full font-semibold capitalize ${activeTab===tab?'bg-indigo-600 text-white':'bg-slate-800 text-slate-300'}`}>{tab}</button>
          ))}
        </div>

        {activeTab==='generate' && (
          <div className="grid md:grid-cols-2 gap-6">
            <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800">
              <h2 className="text-xl font-bold mb-4">Generate New Product</h2>
              <label className="text-sm text-slate-400">Niche Hint (optional)</label>
              <input value={niche} onChange={e=>setNiche(e.target.value)} placeholder="e.g. AI Freelancer Client OS" className="w-full mt-2 mb-4 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2" />
              <label className="text-sm text-slate-400">Batch Size (1-10)</label>
              <input type="number" min={1} max={10} value={batch} onChange={e=>setBatch(parseInt(e.target.value)||1)} className="w-full mt-2 mb-4 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2" />
              <button onClick={generate} disabled={generating} className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 py-3 rounded-xl font-bold">
                {generating? '🧠 Generating with Groq...' : `🚀 Generate ${batch} Product${batch>1?'s':''}`}
              </button>
              <p className="text-xs text-slate-500 mt-3">Uses Groq llama-3.3-70b-versatile + 8b-fast evaluator • Takes ~30-60 sec per product</p>
            </div>
            <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800">
              <h3 className="font-bold mb-2">Last Result</h3>
              <pre className="text-xs bg-slate-950 p-3 rounded-lg overflow-auto max-h-[400px]">{JSON.stringify(lastResult, null, 2) || 'No run yet'}</pre>
            </div>
          </div>
        )}

        {activeTab==='products' && (
          <div>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-2xl font-bold">📦 Products ({products.length})</h2>
              <button onClick={fetchProducts} className="px-4 py-2 bg-slate-800 rounded-lg">Refresh</button>
            </div>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {products.map(p=>(
                <div key={p.id} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 hover:border-indigo-600 transition">
                  <div className="flex justify-between items-start mb-2">
                    <span className={`text-xs px-2 py-1 rounded-full ${p.status==='approved'?'bg-green-900 text-green-300':p.status==='rejected'?'bg-red-900 text-red-300':'bg-slate-800'}`}>{p.status.toUpperCase()} {p.evaluation?.overall?`${p.evaluation.overall}/10`:''}</span>
                    <span className="text-lg font-black">${p.price}</span>
                  </div>
                  <h3 className="font-bold text-lg leading-tight">{p.brandName}</h3>
                  <p className="text-sm text-slate-300 mt-1 line-clamp-2">{p.title}</p>
                  {p.outcome && <p className="text-xs text-emerald-400 mt-2">🎯 {p.outcome.slice(0,100)}</p>}
                  <p className="text-xs text-slate-500 mt-2">Slug: {p.slug}</p>
                  <div className="mt-3 flex gap-2">
                    <a href={`/factory/${p.slug}`} className="text-xs bg-slate-800 px-3 py-1 rounded-lg">View</a>
                    <span className="text-xs text-slate-600">{new Date(p.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab==='ecommerce' && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
            <h2 className="text-2xl font-bold mb-4">🛒 Ecommerce Connectors</h2>
            <p className="text-slate-400 mb-6">Your factory can auto-publish to these platforms via n8n. Set credentials in n8n http://localhost:5678</p>
            <div className="grid md:grid-cols-2 gap-4">
              {[
                {name:'Gumroad', best:'AI, devs, freelancers', fee:'10%', node:'HTTP Request', status:'Recommended #1'},
                {name:'Shopify', best:'Brand, upsells', fee:'$39/mo', node:'Shopify Node', status:'Full Auto'},
                {name:'Etsy', best:'Planners, templates', fee:'$0.20 + 6.5%', node:'Etsy Node OAuth', status:'Full Auto'},
                {name:'WooCommerce', best:'Own site, 0% fee', fee:'Hosting only', node:'WooCommerce Node', status:'Full Auto'},
                {name:'Payhip', best:'Beginners, bundles', fee:'5% free', node:'HTTP Request', status:'Partial'},
                {name:'Ko-fi Shop', best:'Small downloads', fee:'5%', node:'Webhook', status:'Manual upload + webhook sales'},
                {name:'LemonSqueezy', best:'Software, modern checkout', fee:'5% + 50c', node:'HTTP Request', status:'Full API'},
                {name:'Stripe Links', best:'Direct, zero platform', fee:'2.9%', node:'Stripe Node', status:'Direct'},
              ].map(p=>(
                <div key={p.name} className="bg-slate-950 border border-slate-800 p-4 rounded-xl">
                  <h3 className="font-bold">{p.name} <span className="text-xs bg-indigo-900 text-indigo-200 px-2 py-0.5 rounded-full ml-2">{p.status}</span></h3>
                  <p className="text-xs text-slate-400 mt-1">Best for: {p.best}</p>
                  <p className="text-xs text-slate-500">Fee: {p.fee} | Node: {p.node}</p>
                </div>
              ))}
            </div>
            <div className="mt-6 bg-slate-950 p-4 rounded-xl border border-slate-800">
              <h4 className="font-bold">n8n Publishing Flow</h4>
              <pre className="text-xs text-slate-300 mt-2">ZIP Created
  ↓ IF Gumroad creds → Create Gumroad product → Upload ZIP
  ↓ IF Shopify creds → Create Shopify product
  ↓ IF Etsy OAuth → Create Etsy draft listing
  ↓ IF Woo creds → Create Woo product
  ↓ Slack/Discord notification</pre>
            </div>
            <p className="mt-4 text-xs text-slate-500">See full guide: digital-factory/ECOMMERCE_CONNECTORS.md</p>
          </div>
        )}
      </div>
    </div>
  );
}
