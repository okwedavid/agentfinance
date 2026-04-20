"use client";
import { useState } from 'react';
import { createTask } from '@/lib/api';

const TASK_TEMPLATES = [
  { label: '📈 Find arbitrage opportunity', prompt: 'Find the best crypto arbitrage opportunity right now across major exchanges' },
  { label: '🔬 Research top yield farms', prompt: 'Research the top DeFi yield farming opportunities with the best APY and lowest risk this week' },
  { label: '✍️ Write a crypto newsletter', prompt: 'Write a crypto market newsletter for this week covering Bitcoin, Ethereum, and top altcoin movements' },
  { label: '💰 Analyse earning strategies', prompt: 'Analyse the top 3 ways to generate passive income with crypto in the current market' },
  { label: '📊 Market sentiment report', prompt: 'Research the current crypto market sentiment, fear and greed index, and trending coins' },
];

export function NewTaskModal() {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    const action = prompt.trim();
    if (!action) { setError('Please enter a task'); return; }
    setLoading(true);
    setError('');
    try {
      await createTask(action);
      setOpen(false);
      setPrompt('');
      // Trigger a page refresh of tasks - emit custom event
      window.dispatchEvent(new CustomEvent('task:created'));
    } catch (err: any) {
      setError(err.message || 'Task creation failed. Is your backend running?');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-lg text-white text-sm font-medium transition-colors"
      >
        + New Task
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />

          {/* Modal */}
          <div className="relative bg-gray-900 border border-white/10 rounded-2xl p-6 w-full max-w-lg shadow-2xl">
            <h3 className="text-lg font-semibold text-white mb-1">Deploy an Agent</h3>
            <p className="text-sm text-gray-400 mb-5">
              Describe what you want your AI agent to do. It will research, analyse, and generate income for you.
            </p>

            {/* Quick templates */}
            <div className="flex flex-wrap gap-2 mb-4">
              {TASK_TEMPLATES.map(t => (
                <button
                  key={t.label}
                  onClick={() => setPrompt(t.prompt)}
                  className="text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg px-2 py-1 text-gray-300 transition-colors"
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Input */}
            <textarea
              value={prompt}
              onChange={e => { setPrompt(e.target.value); setError(''); }}
              onKeyDown={handleKeyDown}
              placeholder="e.g. Find the best yield farming opportunity with ETH this week..."
              rows={4}
              className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white text-sm placeholder-gray-500 resize-none focus:outline-none focus:border-blue-500 transition-colors"
              autoFocus
            />

            {error && (
              <div className="mt-2 text-sm text-red-400 bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            <div className="flex justify-end gap-3 mt-4">
              <button
                onClick={() => setOpen(false)}
                className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={loading || !prompt.trim()}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-white text-sm font-medium transition-colors"
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" />
                    Deploying agent...
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