import React from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
export default function TaskFlowChart({ tasks }: { tasks: any[] }) {
  const data = tasks.map((t, i) => ({ name: t.id.slice(0,6), value: t.status === 'completed' ? 1 : 0 }));
  return (
    <div className="bg-gray-900 rounded-2xl p-6 shadow">
      <h2 className="text-lg font-semibold text-white mb-2">Task Orchestration</h2>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data}>
          <XAxis dataKey="name" stroke="#fff" fontSize={12} />
          <YAxis stroke="#fff" fontSize={12} />
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <Tooltip />
          <Line type="monotone" dataKey="value" stroke="#6366f1" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
