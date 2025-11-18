'use client';
import React, { useState, useEffect } from 'react';

export default function AgentModal({ open, onClose, onSave, initial }: any){
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [prompt, setPrompt] = useState('');
  useEffect(()=>{ if(initial){ setName(initial.name||''); setRole(initial.role||''); setPrompt(initial.prompt||''); } },[initial]);
  if(!open) return null;
  return (
    <div className="fixed inset-0 flex items-center justify-center z-50">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-gray-900 p-6 rounded w-full max-w-2xl">
        <h3 className="text-lg mb-3">{initial? 'Edit Agent':'New Agent'}</h3>
        <input value={name} onChange={e=>setName(e.target.value)} className="w-full p-2 mb-2 bg-gray-800 rounded" placeholder="Name" />
        <input value={role} onChange={e=>setRole(e.target.value)} className="w-full p-2 mb-2 bg-gray-800 rounded" placeholder="Role" />
        <textarea value={prompt} onChange={e=>setPrompt(e.target.value)} className="w-full p-2 mb-4 bg-gray-800 rounded h-32" placeholder="Prompt" />
        <div className="flex gap-2">
          <button onClick={()=>{ onSave({ name, role, prompt, id: initial?.id }); }} className="px-3 py-1 bg-green-600 rounded">Save</button>
          <button onClick={onClose} className="px-3 py-1 bg-red-600 rounded">Cancel</button>
        </div>
      </div>
    </div>
  );
}
