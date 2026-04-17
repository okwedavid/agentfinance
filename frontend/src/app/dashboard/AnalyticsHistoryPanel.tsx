import React, { useEffect, useState } from 'react';
import { fetchAnalyticsHistory, fetchAnalyticsSummary, clearAnalytics } from '../../lib/api';

interface AnalyticsEntry {
  id: string;
  taskId: string;
  action: string;
  status: string;
  durationMs?: number;
  result?: any;
  createdAt: string;
}

export default function AnalyticsHistoryPanel() {
  const [history, setHistory] = useState<AnalyticsEntry[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [hist, summ] = await Promise.all([
        fetchAnalyticsHistory(100, 0),
        fetchAnalyticsSummary(),
      ]);
      setHistory(hist);
      setSummary(summ);
    } catch (e: any) {
      setError(e.message || 'Failed to load analytics');
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleClear() {
    setClearing(true);
    try {
      await clearAnalytics();
      await load();
    } catch (e: any) {
      setError(e.message || 'Failed to clear analytics');
    }
    setClearing(false);
  }

  return (
    <div className="bg-gray-900 rounded-lg p-6 shadow-lg mt-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-white">Task Analytics History</h2>
        <button
          className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded text-sm disabled:opacity-50"
          onClick={handleClear}
          disabled={clearing}
        >
          {clearing ? 'Clearing...' : 'Clear All'}
        </button>
      </div>
      {error && <div className="text-red-400 mb-2">{error}</div>}
      {summary && (
        <div className="mb-4 flex gap-6 text-gray-200">
          <div>Total: <span className="font-semibold">{summary.total}</span></div>
          <div>Success: <span className="font-semibold text-emerald-400">{summary.success}</span></div>
          <div>Failed: <span className="font-semibold text-red-400">{summary.failed}</span></div>
          <div>Avg Duration: <span className="font-semibold">{Math.round(summary.avgDuration || 0)} ms</span></div>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm text-gray-300">
          <thead>
            <tr className="bg-gray-800">
              <th className="px-2 py-1">Time</th>
              <th className="px-2 py-1">Task ID</th>
              <th className="px-2 py-1">Action</th>
              <th className="px-2 py-1">Status</th>
              <th className="px-2 py-1">Duration (ms)</th>
              <th className="px-2 py-1">Result</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="text-center py-4">Loading...</td></tr>
            ) : history.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-4">No analytics data</td></tr>
            ) : history.map((entry) => (
              <tr key={entry.id} className="border-b border-gray-800">
                <td className="px-2 py-1 whitespace-nowrap">{new Date(entry.createdAt).toLocaleString()}</td>
                <td className="px-2 py-1 font-mono text-xs">{entry.taskId}</td>
                <td className="px-2 py-1">{entry.action}</td>
                <td className={`px-2 py-1 font-semibold ${entry.status === 'success' || entry.status === 'completed' ? 'text-emerald-400' : entry.status === 'failed' ? 'text-red-400' : 'text-yellow-300'}`}>{entry.status}</td>
                <td className="px-2 py-1 text-right">{entry.durationMs ?? '-'}</td>
                <td className="px-2 py-1 max-w-xs truncate" title={typeof entry.result === 'string' ? entry.result : JSON.stringify(entry.result)}>
                  {typeof entry.result === 'string' ? entry.result : JSON.stringify(entry.result)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
