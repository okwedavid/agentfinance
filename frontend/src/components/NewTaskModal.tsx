"use client";
import { useState } from "react";
import { createTask } from "@/lib/api";

const TEMPLATES = [
  { icon: '📈', label: 'Crypto arbitrage', prompt: 'Find the best crypto arbitrage opportunity right now' },
  { icon: '🌾', label: 'Best DeFi yield', prompt: 'Find the highest APY DeFi yield farming opportunity with acceptable risk' },
  { icon: '📊', label: 'Market report', prompt: 'Analyse current crypto market sentiment, trending coins, and fear & greed index' },
  { icon: '✍️', label: 'Crypto newsletter', prompt: 'Write a crypto market newsletter covering Bitcoin, Ethereum, and top movers this week' },
  { icon: '💡', label: 'Earning strategies', prompt: 'Research the top 3 ways to generate passive income with crypto in the current market' },
];

export function NewTaskModal() {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    const action = prompt.trim();
    if (!action) { setError('Please describe a task'); return; }
    setLoading(true);
    setError('');
    try {
      await createTask(action);
      setOpen(false);
      setPrompt('');
      window.dispatchEvent(new CustomEvent('task:created'));
    } catch (e: any) {
      setError(e.message || 'Failed — check backend is running');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Button: flex-shrink-0 prevents it causing layout overflow on mobile */}
      <button
        onClick={() => setOpen(true)}
        className="flex-shrink-0 bg-blue-600 hover:bg-blue-500 active:scale-95 transition-all rounded-lg px-3 py-1.5 text-white text-xs font-semibold whitespace-nowrap"
      >
        + New Task
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="relative w-full sm:max-w-lg bg-[#0f172a] border border-white/10 rounded-t-2xl sm:rounded-2xl p-5 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-semibold">Deploy an Agent</h3>
              <button onClick={() => setOpen(false)} className="text-gray-500 hover:text-gray-300 text-xl leading-none">×</button>
            </div>

            {/* Templates */}
            <div className="flex flex-wrap gap-1.5 mb-4">
              {TEMPLATES.map(t => (
                <button
                  key={t.label}
                  onClick={() => { setPrompt(t.prompt); setError(''); }}
                  className="text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg px-2.5 py-1 text-gray-300 transition-colors"
                >
                  {t.icon} {t.label}
                </button>
              ))}
            </div>

            <textarea
              value={prompt}
              onChange={e => { setPrompt(e.target.value); setError(''); }}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
              placeholder="Describe what you want your agent to do..."
              rows={4}
              autoFocus
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm placeholder-gray-600 resize-none focus:outline-none focus:border-blue-500 transition-colors"
            />

            {error && <p className="text-red-400 text-sm mt-2">{error}</p>}

            <div className="flex gap-3 mt-4">
              <button onClick={() => setOpen(false)} className="flex-1 py-2.5 text-sm text-gray-400 hover:text-white border border-white/10 rounded-xl transition-colors">
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={loading || !prompt.trim()}
                className="flex-1 py-2.5 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl text-white font-semibold transition-colors"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-3.5 h-3.5 border border-white/30 border-t-white rounded-full animate-spin" />
                    Deploying...
                  </span>
                ) : 'Deploy Agent →'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}