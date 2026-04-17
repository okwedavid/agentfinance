"use client";
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { BarChart, Bar, Cell } from 'recharts';

interface AnalyticsData {
  summary: { totalTasks: number; agents: number; successRate: number };
  agents: { agent: string; tasks: number }[];
  trends: { date: string; tasks: number }[];
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

export default function Analytics() {
  const [data, setData] = useState<AnalyticsData | null>(null);

  useEffect(() => {
    fetch('http://localhost:4000/api/analytics/summary', { cache: 'no-store' })
      .then(res => res.json())
      .then(setData);
  }, []);

  if (!data) return <div className="p-8 text-white">Loading analytics...</div>;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 p-8">
      <h1 className="text-4xl font-bold text-white mb-2">Historical Analytics</h1>
      <p className="text-blue-200 mb-8">Trends, success rates and agent performance.</p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <Card className="bg-white/10 backdrop-blur-lg border-white/20 text-white">
          <CardHeader><CardTitle className="text-3xl">{data.summary.totalTasks}</CardTitle></CardHeader>
          <CardContent><p className="text-blue-300">Total Tasks</p></CardContent>
        </Card>
        <Card className="bg-white/10 backdrop-blur-lg border-white/20 text-white">
          <CardHeader>
            <CardTitle className="text-3xl flex items-center gap-2">
              <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
              {data.summary.agents}
            </CardTitle>
          </CardHeader>
          <CardContent><p className="text-blue-300">Agents Online</p></CardContent>
        </Card>
        <Card className="bg-white/10 backdrop-blur-lg border-white/20 text-white">
          <CardHeader><CardTitle className="text-3xl">{data.summary.successRate}%</CardTitle></CardHeader>
          <CardContent><p className="text-blue-300">Success Rate</p></CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="bg-white/10 backdrop-blur-lg border-white/20 text-white">
          <CardHeader><CardTitle>Task Trends (7 Days)</CardTitle></CardHeader>
          <CardContent className="h-96">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.trends}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                <XAxis dataKey="date" stroke="white" />
                <YAxis stroke="white" />
                <Tooltip contentStyle={{ background: 'rgba(0,0,0,0.8)', border: 'none' }} />
                <Line type="monotone" dataKey="tasks" stroke="#3b82f6" strokeWidth={3} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="bg-white/10 backdrop-blur-lg border-white/20 text-white">
          <CardHeader><CardTitle>Agent Performance</CardTitle></CardHeader>
          <CardContent className="h-96">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.agents}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                <XAxis dataKey="agent" stroke="white" />
                <YAxis stroke="white" />
                <Tooltip />
                <Bar dataKey="tasks">
                  {data.agents.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
