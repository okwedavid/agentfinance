"use client";
import React, { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { useTasks } from '../context/TaskContext';

export default function TaskDetailPanel({ taskId }:{ taskId:string }){
  const { patch, remove, refresh } = useTasks();
  const [task, setTask] = useState<any|null>(null);
  const [loading, setLoading] = useState(false);

  async function load(){ setLoading(true); try{ const data = await apiFetch(`/tasks/${taskId}`); setTask(data); }catch(e){ console.error(e); } setLoading(false); }

  useEffect(()=>{ load(); }, [taskId]);

  if(!task) return (<div className="p-4">Loading...</div>);

  return (
    <div className="bg-gray-900 p-4 rounded">
      <h3 className="text-lg mb-2">{task.action}</h3>
      <div className="mb-2 text-sm text-gray-300">Created: {new Date(task.createdAt).toLocaleString()}</div>
      <pre className="bg-gray-800 p-2 rounded text-sm overflow-auto">{JSON.stringify(task.input, null, 2)}</pre>
      <div className="mt-3">
        <h4 className="text-sm text-gray-300">Result</h4>
        <pre className="bg-gray-800 p-2 rounded text-sm overflow-auto">{JSON.stringify(task.result, null, 2)}</pre>
      </div>
      <div className="flex gap-2 mt-4">
        <button onClick={async ()=>{ await patch(task.id, { status: 'completed', completedAt: new Date().toISOString() }); await refresh(); }} className="px-3 py-1 bg-green-600 rounded">Mark Complete</button>
        <button onClick={async ()=>{ await remove(task.id); await refresh(); }} className="px-3 py-1 bg-red-600 rounded">Archive</button>
        <button onClick={load} className="px-3 py-1 bg-gray-700 rounded">Refresh</button>
      </div>
    </div>
  );
}
