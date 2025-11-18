"use client";
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { NewTaskModal } from '@/components/NewTaskModal';
import { Badge } from '@/components/ui/badge';
import ErrorBoundary from '@/components/ErrorBoundary';
import LoadingSkeleton from '@/components/LoadingSkeleton';
import DispatchSelector from '@/components/DispatchSelector';
import { CollabProvider, useCollab } from '@/context/CollabContext';
import { API_URL, REPLAY_ENABLED } from '@/lib/env';

interface Summary {
  totalTasks: number;
  agents: number;
  successRate: number;
}

export default function Dashboard() {
  const [summary, setSummary] = useState<Summary>({ totalTasks: 0, agents: 0, successRate: 0 });
  const [loading, setLoading] = useState(true);
  const [replaying, setReplaying] = useState(false);

  useEffect(() => {
    fetch(`${API_URL}/api/analytics/summary`, { cache: 'no-store' })
      .then(res => res.json())
      .then(data => {
        setSummary(data.summary || { totalTasks: 0, agents: 0, successRate: 0 });
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  async function handleReplay() {
    if (!REPLAY_ENABLED) return;
    setReplaying(true);
    try {
      const sessionId = 'test123';
      await fetch(`${API_URL}/api/tasks/replay?sessionId=${sessionId}`);
    } catch (e) {
      // ignore
    } finally {
      setTimeout(() => setReplaying(false), 1500);
    }
  }

  if (loading) return <LoadingSkeleton className="p-8" />;

  function CollabBadge() {
    const { participants } = useCollab();
    return (
      <div className="flex items-center gap-2">
        <div className="text-sm text-green-300">{participants} collaborating</div>
      </div>
    );
  }

  return (
    <CollabProvider>
    <ErrorBoundary>
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 p-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-4xl font-bold text-white">Dashboard</h1>
          <p className="text-blue-200">Live activity & metrics</p>
        </div>
        <div className="flex items-center gap-3">
          <NewTaskModal />
          <DispatchSelector taskId={`task-${Date.now()}`} />
          <CollabBadge />
          {REPLAY_ENABLED && (
            <Button className="bg-yellow-600 hover:bg-yellow-700" onClick={handleReplay}>
              {replaying ? 'Replaying...' : 'Replay Session'}
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="bg-white/10 backdrop-blur-lg border-white/20 text-white">
          <CardHeader>
            <CardTitle className="text-4xl font-bold">{summary.totalTasks}</CardTitle>
            <p className="text-blue-300">Total Tasks</p>
          </CardHeader>
          <CardContent>
            <Badge className="bg-green-500/20 text-green-300">156 processed</Badge>
          </CardContent>
        </Card>

        <Card className="bg-white/10 backdrop-blur-lg border-white/20 text-white">
          <CardHeader>
            <CardTitle className="text-4xl font-bold">{summary.agents}</CardTitle>
            <p className="text-blue-300">Agents</p>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
              <span className="text-sm">All online</span>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white/10 backdrop-blur-lg border-white/20 text-white">
          <CardHeader>
            <CardTitle className="text-4xl font-bold">{summary.successRate}%</CardTitle>
            <p className="text-blue-300">Success Rate</p>
          </CardHeader>
          <CardContent>
            <Badge className="bg-yellow-500/20 text-yellow-300">Top: alpha</Badge>
          </CardContent>
        </Card>
      </div>
    </div>
    </ErrorBoundary>
    </CollabProvider>
  );
}
