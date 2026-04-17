import React, { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import useWebSocket from '../hooks/useWebSocket';
import { useAuth } from '../context/AuthContext';

const AgentStatsPanel: React.FC = () => {
  const { user } = useAuth();
  const token = typeof window !== 'undefined' ? (document.cookie.match(/token=([^;]+)/)?.[1] || '') : '';
  const { parsedMessages } = useWebSocket(process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:5000', token);

  // Aggregate agent utilization from live events
  const agentCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    parsedMessages.forEach((msg: any) => {
      if (msg && msg.type === 'task:created' && msg.data?.agentId) {
        counts[msg.data.agentId] = (counts[msg.data.agentId] || 0) + 1;
      }
    });
    return Object.entries(counts).map(([agentId, value]) => ({ agentId, value }));
  }, [parsedMessages]);

  return (
    <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl shadow-xl p-6">
      <h2 className="text-xl font-bold text-white mb-4">Agent Utilization</h2>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={agentCounts} margin={{ top: 10, right: 10, left: 0, bottom: 10 }}>
          <XAxis dataKey="agentId" stroke="#fff" fontSize={12} />
          <YAxis stroke="#fff" fontSize={12} />
          <Tooltip />
          <Legend />
          <Bar dataKey="value" fill="#6366f1" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

export default AgentStatsPanel;
