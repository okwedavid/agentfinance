"use client";
import React, { useEffect, useState } from 'react';

export default function TaskTable() {
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/agent/tasks');
        const data = await res.json();
        setTasks(data.tasks || []);
      } catch (e) { console.error(e); }
      setLoading(false);
    }
    load();
  }, []);

  if (loading) return <div className="p-6 bg-white/5 rounded">Loading tasks...</div>;
  if (!tasks.length) return <div className="p-6 bg-white/5 rounded">No tasks yet — create one with the "New Task" button.</div>;

  return (
    <div className="p-4 bg-white/5 rounded">
      <table className="w-full table-auto">
        <thead>
          <tr className="text-left text-sm text-gray-300"><th>Task</th><th>Agent</th><th>Status</th><th>Created</th></tr>
        </thead>
        <tbody>
          {tasks.map(t => (
            <tr key={t.id} className="border-t border-white/5">
              <td className="py-2">{t.action}</td>
              <td>{t.agentId || 'unassigned'}</td>
              <td>{t.status}</td>
              <td>{new Date(t.createdAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
