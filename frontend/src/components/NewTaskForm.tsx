"use client";
import React, { useState } from 'react';

export default function NewTaskForm() {
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState('');

  async function create() {
    try {
      await fetch('/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
      setOpen(false);
      setAction('');
      // TODO: show success/confetti
    } catch (e) { console.error(e); }
  }

  return (
    <div>
      <button onClick={() => setOpen(true)} className="bg-[#3b82f6] px-4 py-2 rounded text-white">New Task</button>
      {open && (
        <div className="fixed inset-0 flex items-center justify-center z-50">
          <div className="bg-black/50 absolute inset-0" onClick={()=>setOpen(false)} />
          <div className="bg-white/5 backdrop-blur p-6 rounded z-10 text-white w-96">
            <h3 className="text-lg font-semibold">Create Task</h3>
            <input value={action} onChange={e=>setAction(e.target.value)} className="mt-4 w-full p-2 rounded bg-white/10" placeholder="Action" />
            <div className="mt-4 flex justify-end space-x-2">
              <button onClick={()=>setOpen(false)} className="px-3 py-2 rounded">Cancel</button>
              <button onClick={create} className="px-3 py-2 rounded bg-[#3b82f6]">Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
