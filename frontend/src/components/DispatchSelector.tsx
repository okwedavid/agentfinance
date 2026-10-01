"use client";
import { useState } from 'react';
import { API_URL } from '@/lib/env';

export default function DispatchSelector({ taskId }: { taskId: string }) {
  const [agents, setAgents] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  // parse AGENTS from env on first render
  if (agents.length === 0) {
    const list = (process.env.NEXT_PUBLIC_AGENTS || 'alpha,beta,gamma').split(',').map(s => s.trim());
    setAgents(list);
  }

  const toggle = (a: string) => {
    setSelected(s => s.includes(a) ? s.filter(x => x !== a) : [...s, a]);
  };

  const dispatch = async () => {
    if (!taskId) return alert('missing taskId');
    setLoading(true);
    try {
      // The session is an HttpOnly cookie the page cannot read, so it is not
      // attached as a header. credentials:'include' is what sends it.
      await fetch(`${API_URL}/api/dispatch`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, agents: selected }),
      });
      alert('Dispatched');
    } catch (e) {
      alert('Failed to dispatch');
    } finally { setLoading(false); }
  };

  return (
    <div className="p-2">
      <div className="mb-2 text-sm text-blue-200">Dispatch to agents</div>
      <div className="flex gap-2 mb-2">
        {agents.map(a => (
          <button key={a} onClick={() => toggle(a)} className={`px-3 py-1 rounded ${selected.includes(a) ? 'bg-blue-600' : 'bg-white/5'}`}>
            {a}
          </button>
        ))}
      </div>
      <button onClick={dispatch} className="bg-green-600 px-3 py-1 rounded" disabled={loading}>{loading ? 'Sending...' : 'Dispatch'}</button>
    </div>
  );
}
