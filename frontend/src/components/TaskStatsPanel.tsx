import React, { useMemo } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import useWebSocket from '../hooks/useWebSocket';
import { useAuth } from '../context/AuthContext';

const COLORS = ['#6366f1', '#22d3ee', '#10b981', '#f59e42', '#ef4444'];

const TaskStatsPanel: React.FC = () => {
  const { user } = useAuth();
  const token = typeof window !== 'undefined' ? (document.cookie.match(/token=([^;]+)/)?.[1] || '') : '';
  const { parsedMessages } = useWebSocket(process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:5000', token);

  // Aggregate status breakdown from live events
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    parsedMessages.forEach((msg: any) => {
      if (msg && msg.type === 'task:created' && msg.data?.status) {
        counts[msg.data.status] = (counts[msg.data.status] || 0) + 1;
      } else if (msg && msg.type === 'task:updated' && msg.data?.status) {
        counts[msg.data.status] = (counts[msg.data.status] || 0) + 1;
      }
    });
    return Object.entries(counts).map(([status, value]) => ({ status, value }));
  }, [parsedMessages]);

  return (
    <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl shadow-xl p-6">
      <h2 className="text-xl font-bold text-white mb-4">Task Status Breakdown</h2>
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie data={statusCounts} dataKey="value" nameKey="status" cx="50%" cy="50%" outerRadius={70} label>
            {statusCounts.map((entry, idx) => (
              <Cell key={`cell-${idx}`} fill={COLORS[idx % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
};

export default TaskStatsPanel;
