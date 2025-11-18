'use client';
import React, { useState } from 'react';
import { apiFetch } from '../lib/api';

export default function CreateTaskButton(){
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState('');
  const [payload, setPayload] = useState('{\n  "example": true\n}');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string| null>(null);
  const [success, setSuccess] = useState<string| null>(null);

  async function submit(e: React.FormEvent){
    e.preventDefault();
    setError(null); setSuccess(null);
    let parsed: any = {};
    try{ parsed = payload ? JSON.parse(payload) : {}; }catch(err:any){ setError('Invalid JSON payload: '+err.message); return; }
    if(!action) { setError('Action is required'); return; }
    setLoading(true);
    try{
      const t = await apiFetch('/tasks/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, input: parsed }),
      });
  // removed: const json = await res.json();
  setSuccess('Task created: '+t.id);
      // dispatch an event so pages can optimistically update if desired
  try{ window.dispatchEvent(new CustomEvent('agentfi:task-created', { detail: t })); }catch(e){}
  setAction(''); setPayload('{\n  \n}');
      setTimeout(()=>{ setSuccess(null); setOpen(false); }, 1200);
    }catch(err:any){
      setError(err.message || String(err));
    }finally{ setLoading(false); }
  }

  return (
    <>
      <div>
        <button onClick={()=>setOpen(true)} className="px-3 py-1 bg-indigo-600 rounded">New Task</button>
      </div>

      {open && (
        <div className="fixed inset-0 flex items-center justify-center z-50">
          <div className="absolute inset-0 bg-black/60" onClick={()=>setOpen(false)} />
          <form onSubmit={submit} className="relative bg-gray-900 p-6 rounded w-full max-w-xl">
            <h3 className="text-lg mb-3">Create Task</h3>
            <label className="block mb-2 text-sm">Action</label>
            <input value={action} onChange={e=>setAction(e.target.value)} className="w-full p-2 mb-3 bg-gray-800 rounded" placeholder="do:summary" />
            <label className="block mb-2 text-sm">Input (JSON)</label>
            <textarea value={payload} onChange={e=>setPayload(e.target.value)} rows={8} className="w-full p-2 mb-3 bg-gray-800 rounded font-mono text-sm" />

            <div className="flex items-center gap-3">
              <button type="submit" disabled={loading} className="px-3 py-1 bg-green-600 rounded">{loading? 'Creating...' : 'Create'}</button>
              <button type="button" onClick={()=>setOpen(false)} className="px-3 py-1 bg-red-600 rounded">Cancel</button>
              <div className="flex-1 text-right text-sm">
                {error && <span className="text-red-400">{error}</span>}
                {success && <span className="text-green-400">{success}</span>}
              </div>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
